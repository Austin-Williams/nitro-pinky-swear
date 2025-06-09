// A contiguous SHA-384 hash of the contents of the .eif image file (excluding section metadata).
// This binds the attestation to the exact image that was built.
export const EXPECTED_PCR0 = "2b6660d810e2273aa80921a9e5712b0ac51117852fddf217deb6436ae05b75e3bdd870048d3dfc4d2b9990aa18897f42"

// A contiguous SHA-384 hash of the kernel binary and the initial ramfs used to boot the enclave.
// This ensures the enclave ran on the expected kernel/boot payload.
export const EXPECTED_PCR1 = "3b4a7e1b5f13c5a1000b3ed32ef8995ee13e9876329f9bc72650b918329ef9cf4e2e4d1e1e37375dab0ba56ba0974d03"

// A contiguous, in-order SHA-384 hash of your user-space application binaries (everything loaded after the boot ramfs). 
// This ties the attestation to the exact code you shipped inside the enclave.
export const EXPECTED_PCR2 = "4c35f5fa352b304f53e32bf230277d237f9555f945c176d1b189b12f1623f5f15acdaa13e92f4e78fc39fc463002663f"
