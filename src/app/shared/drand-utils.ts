import { bls12_381 as bls } from '@noble/curves/bls12-381'
import { sha256 } from '@noble/hashes/sha2'
import { keccak_256 } from '@noble/hashes/sha3'
import { CHash, ensureBytes } from '@noble/curves/abstract/utils'
import { Buffer } from 'buffer'
import {
	isChainedBeacon,
	isUnchainedBeacon,
	isG1G2SwappedBeacon,
	isG1Rfc9380,
	isBn254OnG1,
	HttpChainClient,
	HttpCachingChain,
	fetchBeacon,
	roundAt,
	roundTime
} from 'drand-client'

import type { ChainInfo, G2ChainedBeacon, G2UnchainedBeacon, G1UnchainedBeacon, RandomnessBeacon } from 'drand-client'

type PointG1 = typeof bls.G1.ProjectivePoint.ZERO
type PointG2 = typeof bls.G2.ProjectivePoint.ZERO

const DEFAULT_CHAIN_INFO: ChainInfo = {
	public_key: '868f005eb8e6e4ca0a47c8a77ceaa5309a47978a7c71bc5cce96366b5d7a569937c529eeda66c7293784a9402801af31',
	period: 30, // in seconds
	genesis_time: 1595431050, // in seconds
	hash: '8990e7a9aaed2ffed73dbd7092123d6f289930540d7651336225dc172e51b2ce',
	groupHash: '176f93498eac9ca337150b46d21dd58673ea4e3581185f869672e59fa4cb390a',
	schemeID: 'pedersen-bls-chained',
	metadata: {
		'beaconID': 'default'
	}
}

const chainHash = DEFAULT_CHAIN_INFO.hash
const publicKey = DEFAULT_CHAIN_INFO.public_key
const apiUrl = 'https://api.drand.sh'

const options = {
	disableBeaconVerification: false,
	noCache: false,
	chainVerificationParams: {
		chainHash,
		publicKey
	}
}

const chain = new HttpCachingChain(apiUrl, options)
const client = new HttpChainClient(chain, options)

/**
 * @param unixTimeMs - The time in milliseconds since the Unix epoch
 * @returns The round number at the given time
 * @throws {Error} If the time is before the genesis time of the chain
 */
export function getRoundAt(unixTimeMs: number): number {
	return roundAt(unixTimeMs, DEFAULT_CHAIN_INFO)
}

export function getRoundTime(round: number): number {
	return roundTime(DEFAULT_CHAIN_INFO, round)
}

/**
 * @param round - The round number to get the beacon for
 * @returns The beacon for the given round
 */
export async function getBeacon(round: number): Promise<RandomnessBeacon> {
	return await fetchBeacon(client, round)
}

// A standalone beacon verification that works offline
// Extracted from drand-client (and slightly modified) because it was not exported
// See: https://github.com/drand/drand-client/blob/master/lib/beacon-verification.ts
export async function verifyBeacon(beacon: RandomnessBeacon, expectedRound: number): Promise<boolean> {
	const chainInfo = DEFAULT_CHAIN_INFO

	const publicKey = chainInfo.public_key

	if (beacon.round !== expectedRound) {
		console.error('round was not the expected round')
		return false
	}

	if (!await randomnessIsValid(beacon)) {
		console.error('randomness did not match the signature')
		return false
	}

	if (isChainedBeacon(beacon, chainInfo)) {
		return bls.verify(beacon.signature, await chainedBeaconMessage(beacon), publicKey)
	}

	if (isUnchainedBeacon(beacon, chainInfo)) {
		return bls.verify(beacon.signature, await unchainedBeaconMessage(beacon), publicKey)
	}

	if (isG1G2SwappedBeacon(beacon, chainInfo)) {
		return verifySigOnG1(beacon.signature, await unchainedBeaconMessage(beacon), publicKey)
	}

	if (isG1Rfc9380(beacon, chainInfo)) {
		return verifySigOnG1(beacon.signature, await unchainedBeaconMessage(beacon), publicKey, 'BLS_SIG_BLS12381G1_XMD:SHA-256_SSWU_RO_NUL_')
	}

	if (isBn254OnG1(beacon, chainInfo)) {
		// Lazy-load the bn254 lib only if absolutely necessary. Certain
		// Node.js versions (e.g. v18) encounter issues during its static
		// initialization, which would otherwise crash the entire enclave
		// before this rarely-used code path is reached.
		const { bn254 } = await import('@kevincharm/noble-bn254-drand')
		return bn254.verifyShortSignature(
			beacon.signature,
			await unchainedBeaconMessage(beacon, keccak_256),
			publicKey,
			{ DST: 'BLS_SIG_BN254G1_XMD:KECCAK-256_SVDW_RO_NUL_' }
		)
	}

	console.error(`Beacon type ${chainInfo.schemeID} was not supported or the beacon was not of the purported type`)
	return false

}

// @noble/curves/bls12-381 has not yet implemented public keys on G2, so we've implemented a manual verification for beacons on G1
type G1Hex = Uint8Array | string | PointG1
type G2Hex = Uint8Array | string | PointG2

function normP1(point: G1Hex): PointG1 {
	return point instanceof bls.G1.ProjectivePoint ? point : bls.G1.ProjectivePoint.fromHex(point)
}

function normP2(point: G2Hex): PointG2 {
	return point instanceof bls.G2.ProjectivePoint ? point : bls.G2.ProjectivePoint.fromHex(point)
}

function normP1Hash(point: G1Hex, domainSeparationTag: string): PointG1 {
	return point instanceof bls.G1.ProjectivePoint ? point : (bls.G1.hashToCurve(ensureBytes('point', point), { DST: domainSeparationTag }) as PointG1)
}

export async function verifySigOnG1(
	signature: G1Hex,
	message: G1Hex,
	publicKey: G2Hex,
	// default DST is the invalid one used for 'bls-unchained-on-g1' for backwards compat
	domainSeparationTag = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_NUL_'
): Promise<boolean> {
	const P = normP2(publicKey)
	const Hm = normP1Hash(message, domainSeparationTag)
	const G = bls.G2.ProjectivePoint.BASE
	const S = normP1(signature)
	const ePHm = bls.pairing(Hm, P.negate(), true)
	const eGS = bls.pairing(S, G, true)
	const exp = bls.fields.Fp12.mul(eGS, ePHm)
	return bls.fields.Fp12.eql(exp, bls.fields.Fp12.ONE)
}

async function chainedBeaconMessage(beacon: G2ChainedBeacon): Promise<Uint8Array> {
	const message = Buffer.concat([
		signatureBuffer(beacon.previous_signature),
		roundBuffer(beacon.round)
	])

	return sha256(message)
}

async function unchainedBeaconMessage(beacon: G2UnchainedBeacon | G1UnchainedBeacon, hashFn: CHash = sha256): Promise<Uint8Array> {
	return hashFn(roundBuffer(beacon.round))
}

function signatureBuffer(sig: string) {
	return Buffer.from(sig, 'hex')
}

function roundBuffer(round: number) {
	const buffer = Buffer.alloc(8)
	buffer.writeBigUInt64BE(BigInt(round))
	return buffer
}

async function randomnessIsValid(beacon: RandomnessBeacon): Promise<boolean> {
	const expectedRandomness = sha256(Buffer.from(beacon.signature, 'hex'))
	return Buffer.from(beacon.randomness, 'hex').compare(expectedRandomness) == 0
}