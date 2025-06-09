// src/app/host/run-host-ceremony.ts
import fs from 'node:fs'
import console from 'node:console'
import { zKey } from "snarkjs"
import { compileCircomCircuit, getExpectedPtauFileInfo } from "../shared/zk/circom-compile"
import { blake2b512HashOfFile, sha256HashOfFile, sha256HashOfString } from "../shared/hashes"
import { assertCorrectEnvironment, assertEifExists, checkEifPCRs, downloadFile, ensureDirectoryExists, ensureResourcesAllocated, terminateRunningEnclaves } from "./utils"
import { awaitFiles, sendFiles } from "../shared/vsock/vsock-comms"
import { ENCLAVE_CID, ENCLAVE_LISTEN_PORT, HOST_LISTEN_PORT } from "../shared/vsock/constants"
import { parseAttestationDocument } from "../enclave/attestation/attestation"
import { getBeacon, getRoundAt, getRoundTime, verifyBeacon } from "../shared/drand-utils"
import { runEnclaveInSeparateProcess } from './run-enclave'
import { EXPECTED_PCR0, EXPECTED_PCR1, EXPECTED_PCR2 } from './expected-pcrs'
import type { PtauFileInfo } from "../shared/zk/ptau-file-info"

const CEREMONY_PATH = './ceremony'
const ARTIFACTS_PATH = `${CEREMONY_PATH}/artifacts`

async function run() {

	const circomFile = process.argv[2]
	if (!circomFile) {
		console.error('Usage: tsx run-host-ceremony.ts path/to/circuit.circom')
		process.exit(1)
	}
	console.log('\nPreparing environment to run ceremony\n')


	assertCorrectEnvironment()
	await terminateRunningEnclaves()
	await ensureDirectoryExists(CEREMONY_PATH)
	await ensureDirectoryExists(ARTIFACTS_PATH)
	assertEifExists(`${CEREMONY_PATH}/enclave.eif`)
	checkEifPCRs(`${CEREMONY_PATH}/enclave.eif`, EXPECTED_PCR0, EXPECTED_PCR1, EXPECTED_PCR2)
	ensureResourcesAllocated(CEREMONY_PATH)

	console.log('Environment successfully prepared\n')

	console.log('Gathering files needed for ceremony\n')

	// Compile circuit.circom (required to fetch and verify PTAU file)
	console.log('Compiling circuit.circom (so we can determine which exact PTAU file we need)')
	await compileCircomCircuit(circomFile, CEREMONY_PATH)
	console.log(`SHA256(circuit.r1cs): ${sha256HashOfFile("./ceremony/circuit.r1cs")}`)
	console.log(`SHA256(circuit.wasm): ${sha256HashOfFile("./ceremony/circuit_js/circuit.wasm")}\n`)

	// Fetch and save PTAU file
	console.log('Fetching PTAU file')
	const expectedPtauFileInfo: PtauFileInfo = await getExpectedPtauFileInfo("./ceremony/circuit.r1cs")
	await downloadFile(expectedPtauFileInfo.url, "./ceremony/powersOfTau.ptau")

	// Verify PTAU file hash (Just a pre-flight check. The actual check that matters happens inside the enclave later.)
	console.log('Verifying PTAU file hash (pre-flight check)')
	const actualPtauFileBlake2bHash = blake2b512HashOfFile("./ceremony/powersOfTau.ptau")
	if (actualPtauFileBlake2bHash !== expectedPtauFileInfo.blake2b) {
		throw new Error("PTAU file hash mismatch")
	}
	console.log(`Blake2b(powersOfTau.ptau): ${actualPtauFileBlake2bHash}`)
	console.log('PTAU file verified\n')

	console.log('*****************')
	console.log('Ceremony starting')
	console.log('*****************\n')

	console.log('[Host] Starting enclave...')
	runEnclaveInSeparateProcess('./ceremony/enclave.eif')
	console.log('[Host] Waiting 30 seconds for enclave to finish initializing...\n')
	await new Promise(resolve => setTimeout(resolve, 30000)) // Wait 30 seconds
	console.log('[Host] Proceeding with ceremony\n')

	// Run the equivalent of the cli command: `snarkjs groth16 setup circuit.r1cs pot14_final.ptau circuit_0000.zkey`
	// This creates circuit_0000.zkey which cannot be trusted (because the host cannot be trusted).
	// The actual safe contribution of entropy happens inside the enclave later.
	// This first step is done outside of the enclave because:
	//   (1) it peaks max memory usage at around 5x the PTAU file size
	//   (2) it is a step that does not require any trust for its execution
	//   (3) it reduces the total amount of RAM needed by the enclave to perform its part of the ceremony
	// See https://github.com/iden3/snarkjs/blob/bf28b1cb5aefcefab7e0f70f1fa5e40f764cca72/README.md#groth16 for more info.
	console.log('[Host] Creating circuit_0000.zkey from the PTAU file')
	await zKey.newZKey("./ceremony/circuit.r1cs", "./ceremony/powersOfTau.ptau", "./ceremony/circuit_0000.zkey")
	console.log('[Host] circuit_0000.zkey created')
	console.log(`[Host] SHA256(circuit_0000.zkey): ${sha256HashOfFile("./ceremony/circuit_0000.zkey")}\n`)

	// Verify ZKey 0000
	console.log('[Host] Verifying circuit_0000.zkey')
	const verified_0000 = await zKey.verifyFromR1cs("./ceremony/circuit.r1cs", "./ceremony/powersOfTau.ptau", "./ceremony/circuit_0000.zkey")
	if (!verified_0000) throw new Error("ZKey verification of circuit_0000.zkey failed")
	console.log('[Host] circuit_0000.zkey verified\n')

	// Pass the critical files to the enclave via a single VSock connection.
	console.log('[Host] Sending files to the enclave...')
	await sendFiles({
		cid: ENCLAVE_CID,
		port: ENCLAVE_LISTEN_PORT,
		items: [
			{ filePath: circomFile },
			{ filePath: "./ceremony/powersOfTau.ptau" },
			{ filePath: "./ceremony/circuit_0000.zkey" }
		]
	})

	// Receive time-attestation.cbor from the enclave
	console.log('[Host] Waiting for time-attestation.cbor from the enclave...')
	await awaitFiles({ items: [{ expectedName: 'time-attestation.cbor', saveDir: ARTIFACTS_PATH }], port: HOST_LISTEN_PORT })

	// Grab timestamp from time-attestation.cbor
	const timeAttestation = parseAttestationDocument(Buffer.from(fs.readFileSync(`${ARTIFACTS_PATH}/time-attestation.cbor`)))
	const timestamp = timeAttestation.timestamp

	// Compute DRAND round number that the enclave will expect
	const drandRoundNumber = getRoundAt(timestamp + (90 * 1000))

	// Compute when that round will be available (plus 10 seconds to account for any network latency)
	const drandAvailableTime = getRoundTime(drandRoundNumber) + (10 * 1000)
	const now = Date.now()
	const waitSeconds = Math.max(0, Math.ceil((drandAvailableTime - now) / 1000))
	console.log(`[Host] Waiting for DRAND round ${drandRoundNumber} to be available at UNIX time ${drandAvailableTime}...`)
	console.log(`[Host] Current UNIX time: ${now}. Expected wait: ${waitSeconds} seconds.\n`)

	// Wait until our local time is >= drandAvailableTime
	while (Date.now() < drandAvailableTime) {
		await new Promise((resolve) => setTimeout(resolve, 1000))
	}

	// Fetch the beacon from DRAND
	console.log(`[Host] Fetching DRAND beacon for round ${drandRoundNumber}`)
	const beacon = await getBeacon(drandRoundNumber)
	console.log('[Host] Received DRAND beacon')

	// Verify the beacon (pre-flight check)
	console.log('[Host] Verifying DRAND beacon')
	const verified_drand = await verifyBeacon(beacon, drandRoundNumber)
	if (!verified_drand) throw new Error('[Host] DRAND beacon verification failed')
	console.log('[Host] DRAND beacon verified')

	// Write the beacon to a file
	console.log('[Host] Writing beacon to drand-beacon.json file')
	fs.writeFileSync(`${ARTIFACTS_PATH}/drand-beacon.json`, JSON.stringify(beacon))
	console.log(`[Host] SHA256(drand-beacon.json): ${sha256HashOfString(JSON.stringify(beacon))}\n`)

	// Send the beacon to the enclave
	console.log('[Host] Sending drand-beacon.json to enclave...')
	await sendFiles({ items: [{ filePath: `${ARTIFACTS_PATH}/drand-beacon.json` }], cid: ENCLAVE_CID, port: ENCLAVE_LISTEN_PORT + 1 })

	// Receive final files from enclave
	console.log('[Host] Waiting for final ceremony artifacts from enclave...')
	await awaitFiles({
		port: HOST_LISTEN_PORT + 1,
		items: [
			{ expectedName: 'circuit.circom', saveDir: ARTIFACTS_PATH },
			{ expectedName: 'circuit.r1cs', saveDir: ARTIFACTS_PATH },
			{ expectedName: 'circuit.wasm', saveDir: ARTIFACTS_PATH },
			{ expectedName: 'circuit_final.zkey', saveDir: ARTIFACTS_PATH },
			{ expectedName: 'verifier.sol', saveDir: ARTIFACTS_PATH },
			{ expectedName: 'verifier.creation.hex', saveDir: ARTIFACTS_PATH },
			{ expectedName: 'verifier.extcodehash.hex', saveDir: ARTIFACTS_PATH },
			{ expectedName: 'hashes.txt', saveDir: ARTIFACTS_PATH },
			{ expectedName: 'final-attestation.cbor', saveDir: ARTIFACTS_PATH }
		]
	})

	await new Promise((resolve) => setTimeout(resolve, 2 * 1000))
	console.log('**************************************************************************')
	console.log('[Host] Host side of ceremony completed successfully.')
	console.log('[Host] All ceremony artifacts have been saved to the "ceremony/artifacts" directory.')
	console.log('**************************************************************************\n')

	await new Promise((resolve) => setTimeout(resolve, 4 * 1000))
	process.exit(0)
}

run().catch((e) => { console.error(e); process.exit(1) })
