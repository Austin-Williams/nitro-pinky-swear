#!/usr/bin/env ts-node
/**
 * send-file.ts  – quick one-shot file sender from host → enclave
 *
 * Usage:
 *   npx --no-install tsx ./send-file-from-host-to-enclave.ts path/to/file.name
 *
 * It connects to CID 4, port 5005 (the enclave’s default listener)
 * and streams the given file using sendFile() from shared/vsock-comms.ts
 */

import { basename } from 'path'
import { sendFile } from '../../src/app/shared/vsock-comms'

const filePath = process.argv[2]
if (!filePath) {
	console.error('Usage: tsx send-file-from-host-to-enclave.ts <filePath>')
	process.exit(1)
}

const CID = 4

async function main() {
	const PORT = Number(process.argv[3])
	if (!PORT) {
		console.error('Usage: tsx send-file-from-host-to-enclave.ts <filePath> <port>')
		process.exit(1)
	}
	console.log(`[host] Sending "${basename(filePath)}" -> CID=${CID}, port=${PORT}`)

	await sendFile({ filePath, cid: CID, port: PORT })
	console.log('[host] Transfer complete.')
}

main().catch((err) => {
	console.error('[host][error]', err)
	process.exit(1)
})
