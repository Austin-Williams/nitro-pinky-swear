// shared/vsock-comms.ts
//
// awaitFile() – Spin up a one-shot VSock server, wait for exactly one file,
// save it, and log its SHA-256.  Resolves (void) when done.
//
// Usage example (inside host or enclave):
//   await awaitFile({
//     expectedName: 'circuit.circom',
//     port:         5005,
//     saveDir:      '/tmp/from-peer'
//   });
//
import { createRequire } from 'module'
import { mkdirSync } from 'fs'
import { lowSend } from './proto'
import { statSync } from 'fs'
import { basename } from 'path'
import { createHash } from 'crypto'
import { createWriteStream } from 'fs'
import { join } from 'path'
import { sha256HashOfFile } from '../hashes'

// node-vsock provides no type defs
const requireVsock = createRequire(import.meta.url)
// @ts-ignore
const { VsockServer, VsockSocket } = requireVsock('node-vsock')

export interface AwaitFileItem {
	/** Exact filename we expect (only used for logging) */
	expectedName: string
	/** Directory in which to save the incoming file (must be writable) */
	saveDir: string
}

export interface AwaitFileOpts {
	/** Items describing each file we expect to receive */
	items: AwaitFileItem[]
	/** VSock port on which to listen (e.g. 5005 or 5006) */
	port: number
}

/**
 * Wait for multiple files over a single VSock connection, save them in their
 * respective directories, and log SHA-256 of each.
 * The server resolves once ALL expected files have been fully written.
 */
export function awaitFiles(opts: AwaitFileOpts): Promise<void> {
	const { items, port } = opts
	if (items.length === 0) return Promise.resolve()

	// Pre-create save directories
	for (const { saveDir } of items) mkdirSync(saveDir, { recursive: true })

	console.log(`[vsock] Awaiting ${items.length} file${items.length > 1 ? 's' : ''} on port ${port}\n`)

	return new Promise<void>((resolve, reject) => {
		const server = new VsockServer()
		server.listen(port)

		server.once('error', reject)
		server.once('listening', () => console.log('[vsock] Server listening'))

		server.once('connection', (sock: any) => {
			let idx = 0

			// State for the in-flight file parsing
			type State = 'hdr' | 'name' | 'body'
			let state: State = 'hdr'
			let pending = Buffer.alloc(0)
			let fileSize = 0n
			let nameLen = 0
			let received = 0n
			let fileStream: ReturnType<typeof createWriteStream> | null = null
			let sha = createHash('sha256')
			let currentFilename: string = ''

			const headerLooksSane = (size: bigint, nlen: number): boolean => {
				return size > 0n && size < 1_000_000_000_000n && nlen > 0 && nlen <= 4096
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
					pending = pending.subarray(1)
				}
			}

			sock.on('data', (chunk: Buffer) => {
				pending = Buffer.concat([pending, chunk])
				try {
					while (true) {
						if (state === 'hdr') {
							tryParseHeader()
							if (state === 'hdr') break
						}

						if (state === 'name') {
							if (pending.length < nameLen) break
							const nameBuf = pending.subarray(0, nameLen)
							pending = pending.subarray(nameLen)

							const filename = nameBuf.toString('utf8')
							currentFilename = filename
							const { saveDir, expectedName } = items[idx]
							console.log(`[vsock] Expecting “${expectedName}”`)
							fileStream = createWriteStream(join(saveDir, filename))
							state = 'body'
						}

						if (state === 'body') {
							const remaining = Number(fileSize - received)
							if (remaining === 0) {
								// file already complete
								state = 'hdr' // prepare for next header
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
								const { expectedName, saveDir } = items[idx]
								const fullPath = join(saveDir, currentFilename)
								const byteSize = Number(fileSize)

								// Prepare variables for potential next file BEFORE any more data is processed
								idx += 1
								const isLast = idx === items.length

								// Close stream and log once flushed
								const currentStream = fileStream!
								// Reset state *immediately* to avoid updating a finalized hash if more data is already buffered
								if (!isLast) {
									state = 'hdr'
									fileSize = 0n
									nameLen = 0
									received = 0n
									sha = createHash('sha256')
									fileStream = null
								}

								currentStream.end(() => {
									console.log(`[vsock] Received "${expectedName}"\n\tsaved at ${fullPath}\n\tsize: ${byteSize} bytes\n\tSHA256: ${digest}\n`)
									if (isLast) {
										sock.end()
										server.once('close', () => resolve())
										server.close()
									}
								})

								if (isLast) {
									// nothing more to process in this loop; exit
									break
								}
								// after resetting state, continue looping to handle any buffered data
							}
						}

						// loop again if needed
					}
				} catch (err) {
					sock.destroy()
					server.once('close', () => reject(err))
					server.close()
				}
			})

			sock.once('error', (err: Error) => {
				sock.destroy()
				server.once('close', () => reject(err))
				server.close()
			})
		})
	})
}

export interface SendFilesItem {
	/** Absolute or cwd-relative path of the file to transmit */
	filePath: string
}

export interface SendFilesOpts {
	/** Files to send in desired order */
	items: SendFilesItem[]
	/** Destination CID (4 if host→enc, 3 if enc→host) */
	cid: number
	/** Destination port */
	port: number
}

/**
 * Connects once and streams multiple files sequentially through the same VSock
 * socket, resolving when all have completed.
 */
export function sendFiles(opts: SendFilesOpts): Promise<void> {
	const { items, cid, port } = opts
	if (items.length === 0) return Promise.resolve()

	console.log(`[vsock] Connecting to CID=${cid}, port=${port}`)
	const sock = new VsockSocket()

	return new Promise<void>((resolve, reject) => {
		sock.on('connect', async () => {
			try {
				for (const { filePath } of items) {
					const { size } = statSync(filePath)
					const name = basename(filePath)
					console.log(`[vsock] Connected – sending "${name}" (${size} bytes)…`)
					await lowSend({ socket: sock, filePath })
					console.log(`[vsock] Sent "${name}"\n\tpath: ${filePath}\n\tsize: ${size} bytes\n\tSHA256: ${sha256HashOfFile(filePath)}\n`)
				}
				console.log('[vsock] All file transfers complete; closing socket.\n')
				sock.once('close', resolve)
				sock.end()
			} catch (err) {
				sock.once('close', () => reject(err))
				sock.destroy()
			}
		})

		sock.on('error', reject)
		sock.connect(cid, port)
	})
}
