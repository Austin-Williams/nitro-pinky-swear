import * as fs from 'node:fs/promises'
import * as path from 'node:path'
import * as fsSync from 'fs'
import { execSync } from 'node:child_process'
import { allocateResources } from './allocate-resources'

export async function downloadFile(url: string, destPath: string): Promise<void> {
	console.log(`Downloading ${url}`)
	const response = await fetch(url)
	if (!response.ok) throw new Error(`Failed to download ${url}: ${response.status}`)
	const arrayBuf = await response.arrayBuffer()
	const fsPromises = await import('fs/promises')
	await fsPromises.writeFile(destPath, Buffer.from(arrayBuf))
	console.log(`Downloaded to ${destPath}\n`)
}

export function assertCorrectEnvironment() {
	if (process.arch !== 'arm64') {
		console.warn(`Warning: This application is intended to run on an ARM64 (aarch64) architecture, but the current architecture is ${process.arch}.`)
		console.warn('The Nitro Enclave EIF was built for ARM64 and may not function correctly or at all on other architectures.')
		console.warn('Exiting to prevent potential issues.')
		process.exit(1)
	}
	console.log(`Verified we are running on the correct architecture: ${process.arch}\n`)
}

// Define an interface for errors from execSync, which extends Error
interface ProcessError extends Error {
	status: number | null
	stdout: Buffer | string
	stderr: Buffer | string
	// pid and signal are also available but not used here
}

// Define an interface for the structure of an enclave object from describe-enclaves
interface EnclaveInfo {
	EnclaveID: string
	ProcessID?: number // Optional, as we don't use it
	EnclaveName?: string // Optional, as we provide a fallback
	State?: string // Optional
	Flags?: string // Optional
	CPUIDs?: number[] // Optional
	MemoryMiB?: number // Optional
}

export async function terminateRunningEnclaves() {
	console.log('Ensuring that no enclaves are running yet...')
	let describeOutput: string
	try {
		describeOutput = execSync('nitro-cli describe-enclaves', { encoding: 'utf8' })
	} catch (error: unknown) {
		let errorMessage = 'Unknown error'
		let errorStatus: number | undefined = undefined
		let errorStdout: string | undefined = undefined

		if (error instanceof Error) {
			errorMessage = error.message
			// Type assertion to our custom ProcessError interface
			const execError = error as ProcessError
			if (execError.stderr) {
				errorMessage = execError.stderr.toString().trim()
			}
			if (typeof execError.status === 'number') {
				errorStatus = execError.status
			}
			if (execError.stdout) {
				errorStdout = execError.stdout.toString().trim()
			}
		}

		if (errorMessage.includes("No such file or directory") ||
			errorMessage.includes("Connection refused") ||
			errorMessage.includes("Unable to connect to driver")) {
			console.log('Nitro CLI could not connect to the Nitro Enclaves service. Assuming no enclaves are running.')
		} else if (errorStatus === 1 && (!errorStdout || errorStdout === '') && errorMessage === '') {
			console.log('No running enclaves found (this is good)')
		} else {
			console.warn('Failed to execute "nitro-cli describe-enclaves". Unable to guarantee termination of running enclaves.')
			console.warn('Error details:', errorMessage)
			console.warn('Stdout:', errorStdout || 'N/A')
		}
		console.log('') // Newline for readability
		return
	}

	if (!describeOutput.trim() || describeOutput.trim() === '[]') {
		console.log('No running enclaves found (this is good)\n')
		return
	}

	let enclaves: EnclaveInfo[]
	try {
		enclaves = JSON.parse(describeOutput) as EnclaveInfo[]
	} catch (parseError: unknown) {
		const parseErrorMessage = parseError instanceof Error ? parseError.message : 'Unknown parsing error'
		console.error('Failed to parse output of "nitro-cli describe-enclaves":', parseErrorMessage)
		console.error('Raw output:', describeOutput)
		console.warn('Unable to determine running enclaves due to parsing error. Continuing with caution.')
		console.log('')
		return
	}

	if (!Array.isArray(enclaves) || enclaves.length === 0) {
		console.log('No running enclaves found or output was not an array.')
		console.log('')
		return
	}

	console.log(`Found ${enclaves.length} running enclave(s). Terminating...`)
	let allTerminatedSuccessfully = true
	for (const enclave of enclaves) {
		if (enclave.EnclaveID) {
			console.log(`Attempting to terminate enclave ${enclave.EnclaveID} (Name: ${enclave.EnclaveName || 'N/A'})...`)
			try {
				execSync(`nitro-cli terminate-enclave --enclave-id ${enclave.EnclaveID}`, { encoding: 'utf8', stdio: 'pipe' })
				console.log(`Successfully terminated enclave ${enclave.EnclaveID}.`)
			} catch (terminateError: unknown) {
				allTerminatedSuccessfully = false
				let termErrorMsg = 'Unknown termination error'
				if (terminateError instanceof Error) {
					termErrorMsg = terminateError.message
					// Type assertion to our custom ProcessError interface
					const execTermError = terminateError as ProcessError
					if (execTermError.stderr) {
						termErrorMsg = execTermError.stderr.toString().trim()
					}
				}
				console.error(`Failed to terminate enclave ${enclave.EnclaveID}:`, termErrorMsg)
			}
		} else {
			console.warn('Found an enclave entry without an EnclaveID:', enclave)
		}
	}

	if (allTerminatedSuccessfully && enclaves.length > 0) {
		console.log('All identified running enclaves have been processed.')
	} else if (enclaves.length > 0) {
		console.warn('Some enclaves may not have been terminated successfully. Please check logs.')
	}
	console.log('')
}

export async function ensureDirectoryExists(relativePath: string): Promise<void> {
	const absolutePath = path.resolve(relativePath)
	console.log(`Ensuring directory exists: ${absolutePath}`)
	try {
		await fs.stat(absolutePath)
		console.log('Confirmed directory already exists.\n')
	} catch (error: any) {
		if (error.code === 'ENOENT') {
			console.log('Directory not found. Creating...')
			try {
				await fs.mkdir(absolutePath, { recursive: true })
				console.log(`Successfully created directory "${absolutePath}"\n`)
			} catch (mkdirError: any) {
				console.error(`Failed to create directory "${absolutePath}":`, mkdirError.message)
				process.exit(1)
			}
		} else {
			console.error(`Error checking directory "${absolutePath}":`, error.message)
			process.exit(1)
		}
	}
}

export function ensureResourcesAllocated(pathToCeremonyDirectory: string): void {
	console.log('Checking if resources have been allocated for enclave.')
	// We do this by checking if server-constants.ts exists in the specified ceremony directory.
	const serverConstantsFileName = 'server-constants.ts'
	const serverConstantsPath = path.join(pathToCeremonyDirectory, serverConstantsFileName)
	console.log(`Checking for server-constants.ts at: ${serverConstantsPath}`)

	if (!fsSync.existsSync(serverConstantsPath)) {
		console.log('Resources have not yet been allocated for enclave. Allocating resources now.')
		try {
			allocateResources()

			// Verify that the file was created
			if (fsSync.existsSync(serverConstantsPath)) {
				console.log('Resources for enclave have been allocated successfully.\n')
			} else {
				console.error(`ERROR: 'allocateResources()' ran, but '${serverConstantsPath}' was not created. Please check the script and its output.`)
				process.exit(1)
			}
		} catch (error) {
			const execError = error as Error & { status?: number; signal?: string } // Type assertion for error from execSync
			let detailedErrorMessage = `ERROR: Failed to execute 'allocateResources()'.`
			if (execError.status) detailedErrorMessage += ` Exit status: ${execError.status}.`
			if (execError.signal) detailedErrorMessage += ` Signal: ${execError.signal}.`
			console.error(detailedErrorMessage, execError.message)
			process.exit(1)
		}
	} else {
		console.log(`Resources for enclave have already been allocated.\n`)
	}
}

export function assertEifExists(eifPath: string) {
	console.log(`Checking for EIF file at: ${eifPath}`)
	if (!fsSync.existsSync(eifPath)) {
		console.error(`ERROR: EIF file not found at specified path: ${eifPath}`)
		console.error('Please ensure the EIF file has been built and copied to the correct location.')
		console.error('You can use `sudo ./docker/build-eif.sh`')
		process.exit(1)
	}
	console.log(`EIF file found at: ${eifPath}\n`)
}

export function checkEifPCRs(_eifPath: string, _expectedPCR0: string, _expectedPCR1: string, _expectedPCR2: string) {
	console.log(`**********************************************************************************************************`)
	console.log(`TODO: CIRCLE BACK TO CREATING DETERMINISTIC EIFS AND ADD PCR CHECKING. SKIPPING FOR NOW TO AVOID BREAKING.`)
	console.log(`**********************************************************************************************************`)
	// console.log(`Verifying PCR values for EIF: ${eifPath}`)
	// try {
	// 	const command = `nitro-cli describe-eif --eif-path ${eifPath}`
	// 	const output = execSync(command, { encoding: 'utf8' })
	// 	const eifInfo = JSON.parse(output)

	// 	const actualPCR0 = eifInfo.Measurements?.PCR0
	// 	const actualPCR1 = eifInfo.Measurements?.PCR1
	// 	const actualPCR2 = eifInfo.Measurements?.PCR2

	// 	if (actualPCR2 !== expectedPCR2) {
	// 		console.error(`CRITICAL ERROR: PCR2 mismatch for ${eifPath}`)
	// 		console.error(`  Expected: ${expectedPCR2}`)
	// 		console.error(`  Actual:   ${actualPCR2}`)
	// 		console.error(`This means the EIF's user-space application binaries are not what we expect. Aborting. Check the EIF build process.`)
	// 		process.exit(1)
	// 	} else {
	// 		console.log(`PCR2 verified: The EIF's user-space application binaries are what we expect.`)
	// 	}

	// 	if (actualPCR1 !== expectedPCR1) {
	// 		console.error(`CRITICAL ERROR: PCR1 mismatch for ${eifPath}`)
	// 		console.error(`  Expected: ${expectedPCR1}`)
	// 		console.error(`  Actual:   ${actualPCR1}`)
	// 		console.error(`This means the EIF's kernel/boot payload are not what we expect. Aborting. Check the EIF build process.`)
	// 		process.exit(1)
	// 	} else {
	// 		console.log(`PCR1 verified: The EIF's kernel/boot payload are what we expect.`)
	// 	}


	// 	if (actualPCR0 !== expectedPCR0) {
	// 		console.warn(`WARNING: PCR0 mismatch for ${eifPath}`)
	// 		console.warn(`  Expected: ${expectedPCR0}`)
	// 		console.warn(`  Actual:   ${actualPCR0}`)
	// 		console.warn(`This means the EIF file content hash (excluding section metadata) is different than we expected.\nThis is NOT critical because both PCR1 and PCR2 have been verified. But ideally the EIF build would be 100% bit-for-bit reproducible.`)
	// 	} else {
	// 		console.log(`PCR0 verified: The EIF file has been reproduced bit-for-bit.`)
	// 	}

	// } catch (error: any) {
	// 	console.error(`ERROR: Failed to describe or verify EIF PCRs for ${eifPath}.`)
	// 	if (error.stdout) {
	// 		console.error(`STDOUT: ${error.stdout} `)
	// 		process.exit(1)
	// 	}
	// 	if (error.stderr) {
	// 		console.error(`[Host] STDERR: ${error.stderr} `)
	// 		process.exit(1)
	// 	}
	// 	console.error(`[Host] EIF PCR verification process failed: ${error.message} `)
	// 	process.exit(1)
	// }
}