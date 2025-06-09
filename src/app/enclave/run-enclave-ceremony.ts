// src/app/enclave/run-enclave-ceremony.ts
import fs from 'node:fs'
import { randomBytes } from 'crypto'
import { zKey } from 'snarkjs'
import { sanityCheckHardwareRng } from './entropy'
import { awaitFiles, sendFiles } from '../shared/vsock/vsock-comms'
import { ENCLAVE_LISTEN_PORT, HOST_CID, HOST_LISTEN_PORT } from '../shared/vsock/constants'
import { compileCircomCircuit, getExpectedPtauFileInfo } from '../shared/zk/circom-compile'
import { blake2b512HashOfFile, sha256HashOfFile, sha256HashOfString } from '../shared/hashes'
import { getAttestationDoc, parseAttestationDocument, verifyAttestationSignatures } from './attestation/attestation'
import { getRoundAt, verifyBeacon } from '../shared/drand-utils'
import { compileVerifier, createSolidityVerifierContract } from './ethereum'
import type { PtauFileInfo } from '../shared/zk/ptau-file-info'
import console from 'node:console'


async function run() {

	console.log('\n[Enclave] Enclave side of ceremony starting\n')

	// Sanity check the hardware RNG 
	sanityCheckHardwareRng()

	// Await initial files from the host
	console.log('[Enclave] Waiting for initial files from host...')
	await awaitFiles({
		port: ENCLAVE_LISTEN_PORT,
		items: [
			{ expectedName: 'circuit.circom', saveDir: '.' },
			{ expectedName: 'powersOfTau.ptau', saveDir: '.' },
			{ expectedName: 'circuit_0000.zkey', saveDir: '.' }
		]
	})

	// Compile circuit.circom (required to verify PTAU and ZKey files)
	console.log('[Enclave] Compiling circuit.circom')
	await compileCircomCircuit('circuit.circom')
	console.log(`[Enclave] SHA256(circuit.r1cs): ${sha256HashOfFile('circuit.r1cs')}`)
	console.log(`[Enclave] SHA256(circuit.wasm): ${sha256HashOfFile('circuit_js/circuit.wasm')}\n`)

	// Verify PTAU file hash
	console.log('[Enclave] Verifying PTAU file')
	const expectedPtauFileInfo: PtauFileInfo = await getExpectedPtauFileInfo('circuit.r1cs')
	if (blake2b512HashOfFile('powersOfTau.ptau') !== expectedPtauFileInfo.blake2b) throw new Error('PTAU file hash mismatch')
	console.log('[Enclave] PTAU file verified\n')

	// Verify ZKey 0000
	console.log('[Enclave] Verifying circuit_0000.zkey')
	const verified_0000 = await zKey.verifyFromR1cs(
		'circuit.r1cs',
		'powersOfTau.ptau',
		'circuit_0000.zkey'
	)
	if (!verified_0000) {
		console.error('[Enclave] ZKey verification of circuit_0000.zkey failed')
		throw new Error('[Enclave] ZKey verification of circuit_0000.zkey failed')
	}
	console.log('[Enclave] circuit_0000.zkey verified\n')

	// Now we can add the actual secret entropy that matters
	console.log('[Enclave] Contributing secret entropy...')
	const secretBuf = randomBytes(32)
	let secretHex = secretBuf.toString('hex')
	secretBuf.fill(0)  // scrub raw bytes early
	await zKey.contribute(
		'circuit_0000.zkey',
		'circuit_0001.zkey',
		'Nitro Enclave Contribution',
		secretHex
	)
	secretHex = ''.padEnd(64, '\0') // Zero the hex string copy ASAP
	console.log('[Enclave] Entropy contribution complete. Toxic waste safely overwritten with zeros.\n')

	// Verify ZKey 0001
	console.log('[Enclave] Verifying ZKey circuit_0001.zkey')
	const verified_0001 = await zKey.verifyFromR1cs(
		'circuit.r1cs',
		'powersOfTau.ptau',
		'circuit_0001.zkey'
	)
	if (!verified_0001) {
		console.error('[Enclave] ZKey verification of circuit_0001.zkey failed')
		throw new Error('[Enclave] ZKey verification of circuit_0001.zkey failed')
	}
	console.log('[Enclave] circuit_0001.zkey verified\n')

	// Get attestation that has a signature over the hash of the circuit_0001.zkey file.
	// The purpose is to use the attestation to prove to the outside world that the DRAND value (which will be
	// generated and used as a beacon value later in the ceremony) was not known until AFTER the circuit_0001.zkey file was generated.
	console.log('[Enclave] Requesting first attestation from Nitro Secure Module')
	const timeAttestationNonce: string = sha256HashOfFile('circuit_0001.zkey')
	console.log(`[Enclave] SHA256(circuit_0001.zkey): ${timeAttestationNonce}`)
	await getAttestationDoc('time-attestation.cbor', Buffer.from(timeAttestationNonce, 'hex'))
	console.log('[Enclave] Received first attestation from Nitro Secure Module')
	console.log(`[Enclave] SHA256(time-attestation.cbor): ${sha256HashOfFile('time-attestation.cbor')}\n`)

	// Verify attestation signatures
	console.log('[Enclave] Verifying time-attestation.cbor')
	const verified_time_attestation: boolean = verifyAttestationSignatures(Buffer.from(fs.readFileSync('time-attestation.cbor')))
	if (!verified_time_attestation) {
		console.error('[Enclave] Attestation verification of time-attestation.cbor failed')
		throw new Error('[Enclave] Attestation verification of time-attestation.cbor failed')
	}
	// Verify attestation nonce
	const timeAttestation = parseAttestationDocument(Buffer.from(fs.readFileSync('time-attestation.cbor')))
	if (timeAttestation.nonce !== timeAttestationNonce) {
		console.error('[Enclave] Attestation nonce does not match')
		throw new Error('[Enclave] Attestation nonce does not match')
	}
	console.log('[Enclave] time-attestation.cbor verified\n')

	// Send time-attestation.cbor to host
	console.log('[Enclave] Sending time-attestation.cbor to host')
	await sendFiles({ items: [{ filePath: 'time-attestation.cbor' }], cid: HOST_CID, port: HOST_LISTEN_PORT })

	// Compute DRAND round number that enclave should expect back from the host
	const drandRoundNumber = getRoundAt(timeAttestation.timestamp + (90 * 1000))

	// Wait for DRAND beacon to be received
	console.log(`[Enclave] Waiting for DRAND round ${drandRoundNumber} to be delivered from host`)
	await awaitFiles({ items: [{ expectedName: 'drand-beacon.json', saveDir: '.' }], port: ENCLAVE_LISTEN_PORT + 1 })

	// Verify DRAND beacon
	console.log('[Enclave] Verifying DRAND beacon')
	const drandBeacon = JSON.parse(fs.readFileSync('drand-beacon.json', 'utf-8'))
	const verified_drand = await verifyBeacon(drandBeacon, drandRoundNumber)
	if (!verified_drand) throw new Error('DRAND beacon verification failed')
	const beaconRandomness: string = drandBeacon.randomness
	console.log(`[Enclave] DRAND beacon verified. Beacon randomness: ${beaconRandomness}\n`)

	// Apply the beacon
	console.log('[Enclave] Applying DRAND random beacon to create circuit_final.zkey')
	await zKey.beacon(
		'circuit_0001.zkey',
		'circuit_final.zkey',
		'Nitro Enclave Beacon',
		beaconRandomness,
		10
	)
	console.log('[Enclave] Applied DRAND random beacon and created circuit_final.zkey\n')
	console.log(`[Enclave] SHA256(circuit_final.zkey): ${sha256HashOfFile('circuit_final.zkey')}\n`)

	// Verify ZKey circuit_final.zkey
	console.log('[Enclave] Verifying circuit_final.zkey')
	const verified_final = await zKey.verifyFromR1cs(
		'circuit.r1cs',
		'powersOfTau.ptau',
		'circuit_final.zkey'
	)
	if (!verified_final) throw new Error('[Enclave] ZKey verification of circuit_final.zkey failed')
	console.log('[Enclave] circuit_final.zkey verified\n')

	// Create the Solidity verifier contract
	console.log('[Enclave] Creating Solidity verifier contract')
	await createSolidityVerifierContract('circuit_final.zkey', 'verifier.sol')
	console.log('[Enclave] Solidity verifier contract created\n')

	// Compile the Solidity verifier contract to get the creation bytecode and extcodehash
	console.log('[Enclave] Compiling Solidity verifier contract')
	await compileVerifier('verifier.sol', 'verifier.creation.hex', 'verifier.extcodehash.hex')
	console.log('[Enclave] Solidity verifier contract compiled\n')

	// For the final attestation, we need to commit to everything we want users to be able to trust.
	// We'll include a SHA256 hash of each file, and a SHA256 hash of the concatenation of all the hashes.
	// This will serve as the nonce for the attestation.
	console.log('[Enclave] Committing to ceremony artifacts')
	const filesToCommit: string[] = [
		'circuit.circom',
		'powersOfTau.ptau',
		'circuit_0000.zkey',
		'circuit.r1cs',
		'circuit_js/circuit.wasm',
		'time-attestation.cbor',
		'drand-beacon.json',
		'circuit_final.zkey',
		'verifier.sol',
		'verifier.creation.hex',
		'verifier.extcodehash.hex',
	]
	const fileHashes: string[] = filesToCommit.map((filePath) => sha256HashOfFile(filePath))
	const concatenated = fileHashes.join("")
	const finalAttestationNonce = sha256HashOfString(concatenated)

	// We will also write all these hashes to hashes.txt as a convenience for users.
	// The hash of the hashes.txt file will be put in the user_data field of the final attestation.
	const hashLines = filesToCommit.map((filePath, idx) => `${filePath}: ${fileHashes[idx]}`)
	hashLines.push('')
	hashLines.push(`concatenated: ${concatenated}`)
	hashLines.push(`finalAttestationNonce: ${finalAttestationNonce}`)
	await fs.promises.writeFile('hashes.txt', hashLines.join('\n'), 'utf8')
	const hashOfHashesTxt = sha256HashOfFile('hashes.txt')
	console.log('[Enclave] Committed to ceremony artifacts\n')

	// Get final attestation
	console.log('[Enclave] Requesting final attestation from Nitro Secure Module')
	await getAttestationDoc(
		'final-attestation.cbor',
		Buffer.from(finalAttestationNonce, 'hex'),
		Buffer.from(hashOfHashesTxt, 'hex')
	)
	console.log('[Enclave] Received final attestation from Nitro Secure Module')
	console.log(`[Enclave] SHA256(final-attestation.cbor): ${sha256HashOfFile('final-attestation.cbor')}\n`)

	// Verify attestation signatures
	console.log('[Enclave] Verifying final-attestation.cbor')
	const verified_final_attestation: boolean = verifyAttestationSignatures(Buffer.from(fs.readFileSync('final-attestation.cbor')))
	if (!verified_final_attestation) {
		console.error('[Enclave] Attestation verification of final-attestation.cbor failed')
		throw new Error('[Enclave] Attestation verification of final-attestation.cbor failed')
	}
	// Verify attestation nonce
	const finalAttestation = parseAttestationDocument(Buffer.from(fs.readFileSync('final-attestation.cbor')))
	if (finalAttestation.nonce !== finalAttestationNonce) {
		console.error('[Enclave] Attestation nonce does not match')
		throw new Error('[Enclave] Attestation nonce does not match')
	}
	// Verify attestation user_data
	if (finalAttestation.user_data !== hashOfHashesTxt) {
		console.error('[Enclave] Attestation user_data does not match')
		throw new Error('[Enclave] Attestation user_data does not match')
	}
	console.log('[Enclave] final-attestation.cbor verified\n')

	// Send final files to host
	console.log('[Enclave] Sending ceremony artifacts to host')
	await sendFiles({
		cid: HOST_CID,
		port: HOST_LISTEN_PORT + 1,
		items: [
			{ filePath: 'circuit.circom' },
			{ filePath: 'circuit.r1cs' },
			{ filePath: 'circuit_js/circuit.wasm' },
			{ filePath: 'circuit_final.zkey' },
			{ filePath: 'verifier.sol' },
			{ filePath: 'verifier.creation.hex' },
			{ filePath: 'verifier.extcodehash.hex' },
			{ filePath: 'hashes.txt' },
			{ filePath: 'final-attestation.cbor' }
		]
	})

	await new Promise((resolve) => setTimeout(resolve, 2 * 1000))
	console.log('********************************************************************************************')
	console.log('[Enclave] Enclave side of ceremony completed successfully.')
	console.log('[Enclave] "I deleted that toxic waste. I pinky swear." - AWS Nitro Secure Module, basically.')
	console.log('********************************************************************************************\n')

	await new Promise((resolve) => setTimeout(resolve, 2 * 1000))
	process.exit(0)
}

run().catch((e) => { console.error(e); process.exit(1) })
