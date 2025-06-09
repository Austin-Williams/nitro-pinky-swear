// A contiguous SHA-384 hash of the contents of the .eif image file (excluding section metadata).
// This binds the attestation to the exact image that was built.
export const EXPECTED_PCR0 = "f8d106184fc2c1a0984c3d44e1ced27a990ed31f228c0fc73eec20152b7bf637ec149801a4b26e7f1cd2974e9c7c08fe"

// A contiguous SHA-384 hash of the kernel binary and the initial ramfs used to boot the enclave.
// This ensures the enclave ran on the expected kernel/boot payload.
export const EXPECTED_PCR1 = "3b4a7e1b5f13c5a1000b3ed32ef8995ee13e9876329f9bc72650b918329ef9cf4e2e4d1e1e37375dab0ba56ba0974d03"

// A contiguous, in-order SHA-384 hash of your user-space application binaries (everything loaded after the boot ramfs). 
// This ties the attestation to the exact code you shipped inside the enclave.
export const EXPECTED_PCR2 = "407f75f4e53a79ad985cd24b78231bcb2340e6e3e7c43ebf8dce52b72da75097fe177cbcc46a41535df704b90506d53d"
