import { execSync, spawn } from 'child_process'
import { createWriteStream, existsSync, mkdirSync } from 'fs'
import path from 'path'
import { fileURLToPath, pathToFileURL } from 'url'

export async function runEnclaveInSeparateProcess(pathToEifFile: string) {
	/* logging helpers */
	const info = (...args: any[]) => console.error('\x1b[1;34m▶\x1b[0m', ...args)
	const good = (...args: any[]) => console.error('\x1b[1;32m✓\x1b[0m', ...args)
	const die = (...args: any[]) => {
		console.error('\x1b[1;31m✖\x1b[0m', ...args)
		process.exit(1)
	}

	/* load allocation constants */
	const __filename = fileURLToPath(import.meta.url)
	const __dirname = path.dirname(__filename)

	// Determine project root (assuming run-enclave.ts is in src/app/host/)
	const projectRoot = path.resolve(__dirname, '../../..')
	const constantsFile = path.join(projectRoot, 'ceremony', 'server-constants.ts')

	if (!existsSync(constantsFile)) {
		die(`server-constants.ts not found at ${constantsFile}. Please run allocate-resources.ts first.`)
	}

	// Dynamically import from the absolute path
	const { ENCLAVE_CPU_COUNT, RUN_MIB, ALLOCATION_HAS_RUN } = await import(pathToFileURL(constantsFile).href)

	if (!ALLOCATION_HAS_RUN) {
		die('Allocation has not run (ALLOCATION_HAS_RUN is false in server-constants.ts). Please run allocate-resources.ts first.')
	}

	const CPU_COUNT = ENCLAVE_CPU_COUNT

	/* ─────────── USER‑TUNABLE CONSTANTS ─────────── */
	const CID = 4
	/* ─────────────────────────────────────────────── */

	/* 1) launch the enclave */
	info(`Running: sudo nitro-cli run-enclave --eif-path "${pathToEifFile}" --cpu-count "${CPU_COUNT}" --memory "${RUN_MIB}" --enclave-cid "${CID}" --debug-mode`)
	let raw = ''
	try {
		raw = execSync(`sudo nitro-cli run-enclave --eif-path "${pathToEifFile}" --cpu-count "${CPU_COUNT}" --memory "${RUN_MIB}" --enclave-cid "${CID}" --debug-mode`, {
			encoding: 'utf8'
		})
	} catch (err: any) {
		die(`nitro-cli run-enclave failed: ${err.message}`)
	}

	/* 2) pretty‑print JSON */
	try {
		const obj = JSON.parse(raw)
		console.log(JSON.stringify(obj, null, 2))
	} catch {
		console.log(raw.trim())
	}

	/* 3) extract EnclaveId */
	let enclaveId = ''
	try {
		const obj = JSON.parse(raw)
		enclaveId = obj.EnclaveID || obj.EnclaveId || ''
	} catch {
		const match = raw.match(/"EnclaveI[dD]"\s*:\s*"([^"]+)"/)
		enclaveId = match?.[1] ?? ''
	}
	if (!enclaveId) die('Could not extract EnclaveId from nitro-cli output')

	good(`EnclaveId=${enclaveId}`)
	console.log('Attach console with:')
	console.log(`  sudo nitro-cli console --enclave-id "${enclaveId}"`)

	/* 4) stream console, tee → file */
	const logFile = `./ceremony/artifacts/enclave_${enclaveId}.log`

	// Ensure the directory for logFile exists (e.g. ./ceremony/artifacts)
	const logDir = path.dirname(logFile)
	if (!existsSync(logDir)) {
		try {
			mkdirSync(logDir, { recursive: true })
			good(`Created directory: ${logDir}`)
		} catch (e: any) {
			die(`Failed to create ${logDir}: ${e.message}`)
		}
	}

	info(`Streaming enclave console; saving to ${logFile} (Ctrl-C to exit)`)

	const child = spawn('sudo', ['nitro-cli', 'console', '--enclave-id', enclaveId], {
		stdio: ['ignore', 'pipe', 'inherit']
	})
	const file = createWriteStream(logFile)

	child.stdout?.on('data', chunk => {
		process.stdout.write(chunk)
		file.write(chunk)
	})

	child.on('close', code => {
		file.end()
		good(`Console session ended; log stored at ${logFile}`)
		process.exit(code ?? 0)
	})
}