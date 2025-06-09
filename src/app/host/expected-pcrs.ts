// A contiguous SHA-384 hash of the contents of the .eif image file (excluding section metadata).
// This binds the attestation to the exact image that was built.
export const EXPECTED_PCR0 = "4129bdbff6bcda2b1c5fe3fac519bc6bcae6b1d05811404fda8ea2d51632846bc3ee92a38b4af53e319bbed77af70131"

// A contiguous SHA-384 hash of the kernel binary and the initial ramfs used to boot the enclave.
// This ensures the enclave ran on the expected kernel/boot payload.
export const EXPECTED_PCR1 = "3b4a7e1b5f13c5a1000b3ed32ef8995ee13e9876329f9bc72650b918329ef9cf4e2e4d1e1e37375dab0ba56ba0974d03"

// A contiguous, in-order SHA-384 hash of your user-space application binaries (everything loaded after the boot ramfs). 
// This ties the attestation to the exact code you shipped inside the enclave.
export const EXPECTED_PCR2 = "815702137e4a9df4862f53f5538749c457b996db62329b3feafd5cd3798161c8890ad0bf02ce9314aa242ace533e0805"
