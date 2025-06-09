// A contiguous SHA-384 hash of the contents of the .eif image file (excluding section metadata).
// This binds the attestation to the exact image that was built.
export const EXPECTED_PCR0 = "507dcf0c561b0e14c8686b4a3d70c108bbdbc7d963736382fba42cb36d30e76323bdbab8de9f1e5634450b08ee38ff1e"

// A contiguous SHA-384 hash of the kernel binary and the initial ramfs used to boot the enclave.
// This ensures the enclave ran on the expected kernel/boot payload.
export const EXPECTED_PCR1 = "3b4a7e1b5f13c5a1000b3ed32ef8995ee13e9876329f9bc72650b918329ef9cf4e2e4d1e1e37375dab0ba56ba0974d03"

// A contiguous, in-order SHA-384 hash of your user-space application binaries (everything loaded after the boot ramfs). 
// This ties the attestation to the exact code you shipped inside the enclave.
export const EXPECTED_PCR2 = "30457bb8407a5ae2dfcf57b893a090b0992c95339688a110047546fd3ecf25ea85b8af0d7008aa99f9821b9b8ee2a426"
