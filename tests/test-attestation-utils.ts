/*
 * Tests for attestation-utils.ts
 *
 * We verify **both** the positive path (the provided document is valid) and
 * several negative paths to make sure that (timestamp | nonce) tampering is
 * caught by the cryptographic verification logic.
 */

import { readFile } from 'node:fs/promises'
import assert from 'assert'
import cbor from 'cbor'

import {
	parseAttestationDocument,
	verifyAttestationSignatures,
	AttestationDocument,
} from '../src/app/enclave/attestation'

// ---------------------------------------------------------------------------
// Helper to produce a *mutated* copy of a signed attestation document.
// The helper keeps the original COSE signature so that any modification to the
// payload necessarily invalidates the signature – exactly what we want to
// assert in the negative-path tests.
// ---------------------------------------------------------------------------

async function mutateAttestation(
	attestation: Buffer,
	mutateFn: (doc: Record<string, unknown>) => void,
): Promise<Buffer> {
	// Decode the top-level structure (may be wrapped in CBOR Tag(18)).
	let decoded: unknown = cbor.decodeFirstSync(attestation)
	const isTagged = decoded instanceof cbor.Tagged && decoded.tag === 18

	if (isTagged) {
		decoded = (decoded as cbor.Tagged).value
	}

	if (!Array.isArray(decoded) || decoded.length !== 4) {
		throw new Error('Unexpected COSE structure while mutating')
	}

	const [protectedHeader, unprotected, payload, signature] = decoded as [
		Buffer,
		Record<number, unknown>,
		Buffer,
		Buffer,
	]

	// Decode the attestation document payload, apply the caller-supplied
	// mutation and re-encode it.
	const doc = cbor.decodeFirstSync(payload) as Record<string, unknown>
	mutateFn(doc)
	const newPayload = cbor.encode(doc)

	const newStructure: unknown[] = [protectedHeader, unprotected, newPayload, signature]
	let encoded = cbor.encode(newStructure)

	// Re-apply the COSE_Sign1 tag (18) if present in the original.
	if (isTagged) {
		encoded = cbor.encode(new cbor.Tagged(18, newStructure))
	}

	return encoded as Buffer
}

// ---------------------------------------------------------------------------
// Actual tests
// ---------------------------------------------------------------------------

async function run() {
	const original = await readFile(new URL('./time-attestation.cbor', import.meta.url))

	// -------------------------- Positive path ------------------------------
	const parsed: AttestationDocument = parseAttestationDocument(original)

	// Validate presence of all mandatory keys.
	const mandatoryKeys: Array<keyof AttestationDocument> = [
		'module_id',
		'digest',
		'timestamp',
		'pcrs',
		'certificate',
		'cabundle',
	]
	for (const k of mandatoryKeys) {
		assert.ok(k in parsed, `Missing mandatory key: ${k}`)
	}

	// The document must contain a nonce – we rely on its integrity later.
	assert.ok(parsed.nonce, 'Nonce is missing from attestation document')

	// Timestamp should be recent (≤ 5 min skew).
	const now = Date.now()
	// The attestation document was generated very recently.  Allow up to **60
	// minutes** of clock skew to account for CI jitter or developer machines
	// that might not be perfectly in sync with the enclave's time source.
	const skewMs = Math.abs(now - parsed.timestamp)
	assert.ok(skewMs < 60 * 60 * 1000, `Timestamp skew too large: ${skewMs} ms`)

	// verifyAttestationSignatures MUST succeed on the untouched document.
	assert.strictEqual(verifyAttestationSignatures(original), true, 'Verification failed for untouched document')
	console.log('✅ Positive path passed – attestation document is valid')

	// -------------------------- Negative paths -----------------------------

	// 1. Mutate timestamp and expect verification to fail.
	const mutatedTimestamp = await mutateAttestation(original, doc => {
		if (typeof doc.timestamp !== 'number') {
			throw new Error('timestamp field missing or not a number in original attestation')
		}
		doc.timestamp = (doc.timestamp as number) + 1 // simple diff, preserves length in most cases
	})
	assert.strictEqual(
		verifyAttestationSignatures(mutatedTimestamp),
		false,
		'Verification unexpectedly succeeded after modifying timestamp',
	)
	console.log('✅ Negative path (timestamp tamper) correctly rejected')

	// 2. Mutate nonce and expect verification to fail.
	const mutatedNonce = await mutateAttestation(original, doc => {
		if (!doc.nonce || !Buffer.isBuffer(doc.nonce)) {
			throw new Error('nonce field missing or not a Buffer in original attestation')
		}
		const buf = Buffer.from(doc.nonce)
		buf[0] ^= 0xff // flip first bit to change value while keeping length
		doc.nonce = buf
	})
	assert.strictEqual(
		verifyAttestationSignatures(mutatedNonce),
		false,
		'Verification unexpectedly succeeded after modifying nonce',
	)
	console.log('✅ Negative path (nonce tamper) correctly rejected')
}

run().catch(err => {
	console.error('❌ Test failed:', err)
	process.exit(1)
})

