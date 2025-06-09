import fs from 'node:fs'
import cbor from 'cbor'
import crypto from 'node:crypto'
import { spawn } from 'child_process'
import { writeFile } from 'fs/promises'
import { Buffer } from 'node:buffer'

/**
 * A TypeScript representation of the attestation document payload.
 * The field names correspond 1-to-1 to the CBOR map keys used by Nitro.
 */
export interface AttestationDocument {
	// Mandatory fields
	module_id: string
	timestamp: number // milliseconds since UNIX epoch (uint64)
	digest: string // currently always "SHA384"
	pcrs: Record<number, string> // map [index:number] -> PCR value as hex string
	certificate: string // DER encoded leaf certificate as hex string
	cabundle: string[] // DER encoded intermediate / root certificates as hex strings

	// Optional fields
	public_key?: string
	user_data?: string
	nonce?: string
}

// ---------------------------------------------------------------------------
// Constants / helpers
// ---------------------------------------------------------------------------

const COSE_SIGN1_TAG = 18 // CBOR tag value for COSE_Sign1

// CBOR key values used by COSE headers (RFC 9053 section 16)
const COSE_HEADER_ALG = 1 // protected header: algorithm identifier

// COSE algorithm identifier for ECDSA w/ SHA-384 (see IANA COSE Algorithms)
const COSE_ALG_ECDSA_SHA384 = -35

/**
 * Load the pinned AWS Nitro Enclaves Root-G1 certificate (PEM) at module load
 * time so that verification does not hit the filesystem repeatedly.
 */
const PINNED_ROOT_PEM = fs.readFileSync(new URL('./root.pem', import.meta.url), 'utf8')

const PINNED_ROOT_CERT = new crypto.X509Certificate(PINNED_ROOT_PEM)

// ---------------------------------------------------------------------------
// Parsing helpers
// ---------------------------------------------------------------------------

/**
 * Decode a CBOR encoded COSE_Sign1 container and return its four components.
 *
 * The return value is a tuple of:
 *   [protectedHeaderBytes, unprotectedHeader, payload, signature]
 */
function decodeCoseSign1(
	cose: Buffer,
): [Buffer, Record<number, unknown>, Buffer, Buffer] {
	// `cbor.decode` from v10 performs a full decode of the first CBOR item in
	// the supplied buffer.  There is no longer a *Sync suffix in the API.
	let decoded: unknown = cbor.decodeFirstSync(cose)

	// Handle the CBOR Tag(18, value) wrapper if present.
	if (decoded instanceof cbor.Tagged) {
		if (decoded.tag !== COSE_SIGN1_TAG) {
			throw new Error(`Unsupported COSE tag ${decoded.tag}, expected 18`)
		}
		decoded = decoded.value
	}

	if (!Array.isArray(decoded) || decoded.length !== 4) {
		throw new Error('Malformed COSE_Sign1 structure')
	}

	const [protectedHeaderBytes, unprotectedHeader, payload, signature] = decoded as [
		Buffer,
		Record<number, unknown>,
		Buffer,
		Buffer,
	]

	if (!Buffer.isBuffer(protectedHeaderBytes)) {
		throw new Error('Invalid protected header (expected bstr)')
	}
	if (!Buffer.isBuffer(payload)) {
		throw new Error('Invalid payload (expected bstr)')
	}
	if (!Buffer.isBuffer(signature)) {
		throw new Error('Invalid signature (expected bstr)')
	}

	return [protectedHeaderBytes, unprotectedHeader, payload, signature]
}

/**
 * Minimal conversion of a raw (r || s) ECDSA signature (P-384, so 96 bytes)
 * into the ASN.1 DER representation expected by Node.js `crypto.verify`.
 */
function ecdsaRsToDer(rawSig: Buffer): Buffer {
	if (rawSig.length % 2 !== 0) {
		throw new Error('Invalid ECDSA signature length')
	}

	const r = rawSig.slice(0, rawSig.length / 2)
	const s = rawSig.slice(rawSig.length / 2)

	// Helper to encode a single INTEGER.
	const encodeInt = (buf: Buffer): Buffer => {
		// Remove leading zeros.
		let i = 0
		while (i < buf.length - 1 && buf[i] === 0) i++
		let v = buf.slice(i)

		// If most-significant bit is 1 we need to prepend a 0x00 so that the
		// integer is interpreted as positive (two's complement rule).
		if (v[0] & 0x80) {
			v = Buffer.concat([Buffer.from([0x00]), v])
		}

		return Buffer.concat([Buffer.from([0x02, v.length]), v])
	}

	const rEnc = encodeInt(r)
	const sEnc = encodeInt(s)

	const seqLen = rEnc.length + sEnc.length
	return Buffer.concat([Buffer.from([0x30, seqLen]), rEnc, sEnc])
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Parse the attestation document contained in a raw SignedAttestation blob
 * (the exact same bytes returned by the Nitro hypervisor).  The function
 * validates _syntax_ and _basic semantic_ rules as described in AWS’ public
 * documentation and returns the strongly typed representation.
 *
 * If any mandatory field is missing or invalid the function throws.
 *
 * NOTE: Cryptographic verification (certificate chain & COSE signature) is
 * handled separately by `verifyAttestation` – this function focuses on the
 * structural aspects that callers might want to access directly.
 */
export function parseAttestationDocument(attestation: Buffer): AttestationDocument {
	// First decode COSE to obtain the payload.
	const [, , payload] = decodeCoseSign1(attestation)

	// The payload is itself a CBOR map.
	const doc = cbor.decodeFirstSync(payload) as Record<string, unknown>

	// ------ Structural validation of mandatory fields ---------------------

	const mandatoryKeys = [
		'module_id',
		'digest',
		'timestamp',
		'pcrs',
		'certificate',
		'cabundle',
	]

	for (const k of mandatoryKeys) {
		if (!(k in doc)) {
			throw new Error(`Attestation document missing mandatory field '${k}'`)
		}
	}

	// module_id – non-empty text string
	if (typeof doc.module_id !== 'string' || doc.module_id.length === 0) {
		throw new Error('Invalid module_id')
	}

	// digest – currently only "SHA384" is accepted
	if (doc.digest !== 'SHA384') {
		throw new Error(`Unsupported digest '${doc.digest}'`)
	}

	// timestamp – positive integer
	if (
		typeof doc.timestamp !== 'number' ||
		!Number.isFinite(doc.timestamp) ||
		doc.timestamp <= 0
	) {
		throw new Error('Invalid timestamp')
	}

	// pcrs – Map<number, Buffer>
	if (typeof doc.pcrs !== 'object' || doc.pcrs === null) {
		throw new Error('Invalid pcrs map')
	}

	const pcrs: Record<number, string> = {}

	// The CBOR library might decode maps either as regular JS objects (when all
	// keys are strings) or as actual `Map` instances when keys are ints.  We
	// support both representations.
	const iteratePcrEntries =
		doc.pcrs instanceof Map
			? doc.pcrs.entries()
			: Object.entries(doc.pcrs as Record<string, unknown>)

	for (const [key, value] of iteratePcrEntries) {
		const idx = Number(key)
		if (!Number.isInteger(idx) || idx < 0 || idx >= 32) {
			throw new Error(`Invalid PCR index '${String(key)}'`)
		}

		if (!Buffer.isBuffer(value)) {
			throw new Error(`PCR value for index ${idx} is not a byte string`)
		}

		if (![32, 48, 64].includes(value.length)) {
			throw new Error(`PCR ${idx} has invalid length ${value.length}`)
		}

		pcrs[idx] = value.toString('hex')
	}

	if (Object.keys(pcrs).length === 0) {
		throw new Error('pcrs map cannot be empty')
	}

	// certificate – Buffer size 1..1024
	if (!Buffer.isBuffer(doc.certificate) || doc.certificate.length === 0 || doc.certificate.length > 1024) {
		throw new Error('Invalid certificate field')
	}

	// cabundle – non-empty array of Buffer (each 1..1024 bytes)
	if (!Array.isArray(doc.cabundle) || doc.cabundle.length === 0) {
		throw new Error('Invalid cabundle')
	}

	for (const [i, cert] of (doc.cabundle as unknown[]).entries()) {
		if (!Buffer.isBuffer(cert) || cert.length === 0 || cert.length > 1024) {
			throw new Error(`Invalid certificate at cabundle[${i}]`)
		}
	}

	// Optional fields sizes
	const checkOptionalBuffer = (name: string, max: number) => {
		const val = doc[name as keyof typeof doc] as unknown
		if (val === undefined || val === null) return
		if (!Buffer.isBuffer(val)) {
			throw new Error(`${name} must be a byte string`)
		}
		if (val.length > max) {
			throw new Error(`${name} exceeds max length`)
		}
	}

	checkOptionalBuffer('public_key', 1024)
	checkOptionalBuffer('user_data', 512)
	checkOptionalBuffer('nonce', 512)

	// Build the strongly typed object to return.
	const typed: AttestationDocument = {
		module_id: doc.module_id as string,
		digest: doc.digest as string,
		timestamp: doc.timestamp as number,
		pcrs,
		certificate: (doc.certificate as Buffer).toString('hex'),
		cabundle: (doc.cabundle as Buffer[]).map(buf => buf.toString('hex')),
	}

	if (Buffer.isBuffer(doc.public_key)) typed.public_key = (doc.public_key as Buffer).toString('hex')
	if (Buffer.isBuffer(doc.user_data)) typed.user_data = (doc.user_data as Buffer).toString('hex')
	if (Buffer.isBuffer(doc.nonce)) typed.nonce = (doc.nonce as Buffer).toString('hex')

	return typed
}

/**
 * Cryptographically verify an attestation document.  The function performs
 * three independent checks:
 *   (1) the COSE signature (ECDSA-384) over the payload is valid;
 *   (2) the leaf certificate used for the signature chains up to the pinned
 *       AWS Nitro Enclaves Root-G1 certificate;
 *   (3) every certificate in the chain is currently within its validity
 *       period.
 *
 * The certificate chain and all data required for verification is embedded
 * inside the attestation document so no network request is needed.
 *
 * On success the function returns `true`; on any failure it returns `false`.
 */
export function verifyAttestationSignatures(attestation: Buffer): boolean {
	try {
		// 1. Parse COSE structure
		const [protectedHeaderBytes, _unprotectedHeader, payload, signature] = decodeCoseSign1(attestation)

		// 2. Verify protected header algorithm
		const protectedHeaderDecoded = cbor.decodeFirstSync(protectedHeaderBytes) as Map<number, unknown> | Record<number, unknown>
		const algVal = protectedHeaderDecoded instanceof Map
			? protectedHeaderDecoded.get(COSE_HEADER_ALG)
			: (protectedHeaderDecoded as Record<number, unknown>)[COSE_HEADER_ALG]
		if (algVal !== COSE_ALG_ECDSA_SHA384) {
			console.error(`[verifyAttestation] unexpected algorithm: ${algVal} (expected ${COSE_ALG_ECDSA_SHA384})`)
			throw new Error(`Unsupported COSE algorithm: ${algVal}`)
		}

		// 3. Parse attestation document to obtain certificate + cabundle
		const doc = parseAttestationDocument(attestation)

		const leafCert = new crypto.X509Certificate(Buffer.from(doc.certificate, 'hex'))

		// Build certificate chain: [leaf, ...cabundle]
		const chainCerts: crypto.X509Certificate[] = [leafCert]
		// The CA bundle provided by Nitro is ordered [ROOT, INTERM_1, ..., INTERM_N].
		// For signature verification we need the chain in the opposite direction
		// so that each certificate is followed by its issuer.  Therefore we append
		// the bundle in REVERSE order.
		for (const certHex of [...doc.cabundle].reverse()) {
			chainCerts.push(new crypto.X509Certificate(Buffer.from(certHex, 'hex')))
		}

		// 4. Validate certificate chain

		// Ensure that the last certificate in the chain matches the pinned root.
		const rootCert = chainCerts[chainCerts.length - 1]
		if (rootCert.raw.toString('base64') !== PINNED_ROOT_CERT.raw.toString('base64')) {
			throw new Error('Certificate chain does not terminate at the pinned root')
		}

		// Validate each cert (except root) is issued by the next and that the
		// signature is correct.
		for (let i = 0; i < chainCerts.length - 1; i++) {
			const child = chainCerts[i]
			const issuer = chainCerts[i + 1]

			// Subject/Issuer DN chain check.
			if (child.issuer !== issuer.subject) {
				throw new Error('Certificate issuer/subject mismatch in chain')
			}

			// Temporally validity check for the child certificate.
			if (!isCertCurrentlyValid(child)) {
				throw new Error('Certificate is not currently valid')
			}

			// Verify the signature on the child certificate using issuer public key.
			if (!child.verify(issuer.publicKey)) {
				throw new Error('Certificate signature verification failed')
			}
		}

		// Verify root certificate validity (time) as well.
		if (!isCertCurrentlyValid(rootCert)) {
			throw new Error('Root certificate is not currently valid')
		}

		// 5. Verify COSE signature

		// Build SigStructure per RFC 9053 §4.4
		const sigStructure = cbor.encode([
			'Signature1', // context
			protectedHeaderBytes, // body_protected
			Buffer.alloc(0), // external_aad
			payload, // payload (attestation document)
		])

		const verifier = crypto.createVerify('sha384')
		verifier.update(sigStructure)
		verifier.end()

		const derSignature = ecdsaRsToDer(signature)

		if (!verifier.verify(leafCert.publicKey, derSignature)) {
			throw new Error('COSE signature verification failed')
		}

		// All checks passed.
		return true
	} catch (err) {
		console.error('[verifyAttestation] failed:', err)
		return false
	}
}

// ------------------
// Internal helpers
// ------------------

function isCertCurrentlyValid(cert: crypto.X509Certificate): boolean {
	const now = Date.now()
	const notBefore = Date.parse(cert.validFrom)
	const notAfter = Date.parse(cert.validTo)
	return now >= notBefore && now <= notAfter
}


/**
 * Fetch the Nitro Enclave attestation document and store it on disk.
 *
 * @param filename  Destination file path to write the raw CBOR document.
 * @param nonce     Optional 64-byte nonce that will be included in the
 *                  attestation request. If provided it **must** be ≤ 64 bytes
 *                  (extra bytes are not allowed by the NSM API).
 * @param userData  Optional arbitrary user data (≤ 512 bytes) that should be
 *                  embedded in the attestation document’s `user_data` field.
 *
 * @returns         The attestation document bytes.
 */
export async function getAttestationDoc(
	filename: string,
	nonce?: Buffer,
	userData?: Buffer,
): Promise<Buffer> {
	if (nonce && nonce.length > 64) {
		throw new Error(`Nonce too large – maximum supported size is 64 bytes, got ${nonce.length}`)
	}

	if (userData && userData.length > 512) {
		throw new Error(`userData too large – maximum supported size is 512 bytes, got ${userData.length}`)
	}

	const args: string[] = []

	// Positional arguments expected by /bin/get-attestation:
	//   [0] – nonce hex (may be empty string if omitted)
	//   [1] – user_data hex (optional)

	if (nonce) {
		args.push(nonce.toString('hex'))
	} else if (userData) {
		// placeholder to keep argument order when only userData is supplied
		args.push('')
	}

	if (userData) {
		args.push(userData.toString('hex'))
	}

	const attestation = await new Promise<Buffer>((resolve, reject) => {
		const child = spawn('/bin/get-attestation', args)

		const chunks: Buffer[] = []

		child.stdout.on('data', (chunk) => chunks.push(chunk))
		child.stderr.on('data', (err) => process.stderr.write(err))

		child.on('close', (code) => {
			if (code === 0) {
				resolve(Buffer.concat(chunks))
			} else {
				reject(new Error(`get-attestation exited with code ${code}`))
			}
		})
	})

	await writeFile(filename, attestation)
	return attestation
}
