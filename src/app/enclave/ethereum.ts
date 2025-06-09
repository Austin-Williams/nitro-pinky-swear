import { exec } from 'child_process'
import { promisify } from 'util'
const execAsync = promisify(exec)

export async function createSolidityVerifierContract(zkeyPath: string, outputPath: string = './verifier.sol') {
	console.log('Creating Solidity verifier contract…')
	await execAsync(`snarkjs zkey export solidityverifier ${zkeyPath} ${outputPath}`)
	console.log(`Solidity verifier contract created at ${outputPath}`)
}

/**
 * compileVerifier:
 *  1. Reads a Solidity source file (e.g., `verifier.sol`),
 *  2. Compiles it with solc (pinning the exact version and settings for determinism),
 *  3. Extracts the creation (deployment) bytecode,
 *  4. Extracts the runtime bytecode,
 *  5. Computes keccak256(runtime bytecode) → the value `EXTCODEHASH` would return on-chain (using @noble/hashes),
 *  6. Saves:
 *     - The creation bytecode (hex, no “0x” prefix) to a specified file,
 *     - The runtime-code hash (hex, no “0x” prefix) to another file.
 */

import { promises as fs } from "fs"
import path from "path"
import solc from "solc"
import { keccak_256 } from "@noble/hashes/sha3"

// Utility to convert a Uint8Array to a hex string (no “0x” prefix)
function toHexNoPrefix(bytes: Uint8Array): string {
	let hex = ""
	for (const b of bytes) {
		hex += b.toString(16).padStart(2, "0")
	}
	return hex
}

export async function compileVerifier(
	inputSolPath: string,
	outputCreationPath: string,
	outputExtcodehashPath: string
): Promise<void> {
	// 1. Read the .sol file
	const absoluteInputPath = path.resolve(inputSolPath)
	const sourceCode = await fs.readFile(absoluteInputPath, "utf8")

	// 2. Construct Standard JSON input for solc
	const inputJSON = {
		language: "Solidity",
		sources: {
			[path.basename(absoluteInputPath)]: {
				content: sourceCode,
			},
		},
		settings: {
			outputSelection: {
				"*": {
					"*": ["evm.bytecode.object", "evm.deployedBytecode.object"],
				},
			},
			metadata: {
				bytecodeHash: "none", // disable metadata hashing for determinism
			},
		},
	}

	// 3. Compile with solc
	const inputString = JSON.stringify(inputJSON)
	const outputString = solc.compile(inputString)
	const output = JSON.parse(outputString) as {
		errors?: Array<{ severity: string; formattedMessage: string }>
		contracts?: {
			[fileName: string]: {
				[contractName: string]: {
					evm: {
						bytecode: { object: string }
						deployedBytecode: { object: string }
					}
				}
			}
		}
	}

	// 4. Check for compilation errors (only throw on “error”)
	if (output.errors) {
		const fatalErrors = output.errors.filter((e) => e.severity === "error")
		if (fatalErrors.length > 0) {
			for (const e of fatalErrors) {
				console.error(e.formattedMessage)
			}
			throw new Error("Solidity compilation failed")
		}
	}

	// 5. Extract creation & runtime bytecode
	const fileKey = path.basename(absoluteInputPath)
	const contractsInFile = output.contracts?.[fileKey]
	if (!contractsInFile) {
		throw new Error(`No contracts found in ${fileKey}`)
	}

	// There is only one contract per file, so extract it directly.
	const entries = Object.entries(contractsInFile)
	if (entries.length !== 1) {
		throw new Error(
			`Expected exactly one contract in ${fileKey}, found ${entries.length}`
		)
	}
	const [_, contractData] = entries[0]

	const creationHex = contractData.evm.bytecode.object
	const runtimeHex = contractData.evm.deployedBytecode.object

	if (!creationHex || creationHex.length === 0) {
		throw new Error("Creation bytecode is empty")
	}
	if (!runtimeHex || runtimeHex.length === 0) {
		throw new Error("Runtime bytecode is empty")
	}

	// 6. Compute keccak256(runtime bytecode) = on-chain EXTCODEHASH
	const runtimeBytes = Uint8Array.from(Buffer.from(runtimeHex, "hex"))
	const hashBytes = keccak_256(runtimeBytes) // returns Uint8Array of length 32
	const runtimeBytes32Hash = toHexNoPrefix(hashBytes)

	// 7. Save creationHex and runtimeBytes32Hash to their files
	const absCreationPath = path.resolve(outputCreationPath)
	const absExtcodehashPath = path.resolve(outputExtcodehashPath)

	// Ensure directories exist
	await fs.mkdir(path.dirname(absCreationPath), { recursive: true })
	await fs.mkdir(path.dirname(absExtcodehashPath), { recursive: true })

	// Write out: no “0x” prefix—just raw hex
	await fs.writeFile(absCreationPath, creationHex, "utf8")
	await fs.writeFile(absExtcodehashPath, runtimeBytes32Hash, "utf8")
}
