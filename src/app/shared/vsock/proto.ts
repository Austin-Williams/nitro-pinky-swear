// proto.ts – encode/decode helpers used by both sides
import { createHash } from 'crypto'
import { createReadStream, createWriteStream, promises as fsp } from 'fs'
import { pipeline } from 'stream/promises'
import { Writable } from 'stream'
import { join, basename } from 'path'
import { Buffer } from 'buffer'

export interface SendOpts {
	socket: any // VsockSocket (client side)
	filePath: string // absolute or cwd-relative
}

export async function recvFile(opts: RecvOpts): Promise<string> {
	const { socket, saveDir } = opts

	await fsp.mkdir(saveDir, { recursive: true })

	type State = 'hdr' | 'name' | 'body' | 'done'
	let state: State = 'hdr'

	let pending = Buffer.alloc(0)
	let fileSize = 0n
	let nameLen = 0
	let received = 0n

	let fileStream: ReturnType<typeof createWriteStream> | null = null
	const sha = createHash('sha256')

	const headerLooksSane = (size: bigint, nlen: number): boolean => {
		return (
			size > 0n &&
			size < 1_000_000_000_000n && // 1 TB safety cap
			nlen > 0 &&
			nlen <= 4096
		)
	}

	const tryParseHeader = () => {
		while (pending.length >= 10) {
			const possSize = pending.readBigUInt64LE(0)
			const possNameLen = pending.readUInt16LE(8)

			if (headerLooksSane(possSize, possNameLen)) {
				fileSize = possSize
				nameLen = possNameLen
				pending = pending.subarray(10)
				state = 'name'
				return
			}
			// Slide one byte forward and retry.
			pending = pending.subarray(1)
		}
	}

	return new Promise<string>((resolve, reject) => {
		socket
			.on('data', (chunk: Buffer) => {
				pending = Buffer.concat([pending, chunk])

				try {
					while (true) {
						if (state === 'hdr') {
							tryParseHeader()
							if (state === 'hdr') break // still need more bytes for a full header
						}

						if (state === 'name') {
							if (pending.length < nameLen) break
							const nameBuf = pending.subarray(0, nameLen)
							pending = pending.subarray(nameLen)

							const filename = nameBuf.toString('utf8')
							const full = join(saveDir, filename)
							fileStream = createWriteStream(full)
							state = 'body'
						}

						if (state === 'body') {
							const remaining = Number(fileSize - received)
							if (remaining === 0) {
								state = 'done'
								continue
							}

							if (pending.length === 0) break

							const toWrite = pending.subarray(0, Math.min(remaining, pending.length))
							pending = pending.subarray(toWrite.length)

							fileStream!.write(toWrite)
							sha.update(toWrite)
							received += BigInt(toWrite.length)

							if (received === fileSize) {
								const digest = sha.digest('hex')
								fileStream!.end(() => resolve(digest))
								state = 'done'
								// Don't break here; we just won't loop again since state==='done'
							}
						}

						if (state === 'done') break
					}
				} catch (err) {
					reject(err as Error)
				}
			})
			.once('error', reject)
	})
}


export async function lowSend({ socket, filePath }: SendOpts) {
	const st = await fsp.stat(filePath)
	const fileSize = BigInt(st.size)
	const nameBuf = Buffer.from(basename(filePath), 'utf8')
	if (nameBuf.length > 0xffff) throw new Error('Filename too long')

	const header = Buffer.alloc(10)
	header.writeBigUInt64LE(fileSize, 0)
	header.writeUInt16LE(nameBuf.length, 8)

	if (process.env.DEBUG_VSOCK) {
		console.log('[proto host] header bytes', header, 'nameLen', nameBuf.length)
	}

	// helper to ensure full buffer is written (writeSync may write < len)
	const safeWriteSync = (buf: Buffer) => {
		let offset = 0
		while (offset < buf.length) {
			offset += socket.writeSync(buf.subarray(offset))
		}
	}

	safeWriteSync(header)
	safeWriteSync(nameBuf)
	const sink = new Writable({
		write(chunk: Buffer, _enc: BufferEncoding, cb: (err?: Error | null) => void) {
			try {
				safeWriteSync(chunk)
				cb()
			} catch (e) {
				cb(e as Error)
			}
		},
		final(cb: (err?: Error | null) => void) { cb() }
	})
	await pipeline(createReadStream(filePath), sink)
}

export interface RecvOpts {
	socket: any // VsockSocket (server side)
	saveDir: string // where to place file
}