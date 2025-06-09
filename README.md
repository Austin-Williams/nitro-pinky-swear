> THIS REPO IS UNDER VERY ACTIVE DEVELOPMENT AND IS EXTREMELY UNSTABLE. DO NOT BOTHER TRYING TO CONTRIBUTE OR USE IT YET.

# nitro-pinky-swear
Runs a Groth16 trusted-setup ceremony using SnarkJS inside a TEE (AWS Nitro Enclave) and verifies the remote attestation. If you trust AWS Nitro Enclaves, you can trust that the toxic waste from the ceremony was securely deleted and never accessible.

> "I deleted that toxic waste. I pinky swear." - AWS Nitro Secure Module, basically.

## Requirements

- Node.js 18.x
- Docker

## Limitations

Can only support circuit sizes up to 2^26 (64M max constraints), due to the Nitro Enclave's 512GiB RAM limit.
(Can support 2^27 if you use a r8g.24xlarge instead of r8g.16xlarge. 2^27 may take 24 hours and cost $100, though it has not been tested.)

## Notes
sudo ./scripts/build-eif.sh

// Run allocateResources manually
tsx -e "import { allocateResources } from './src/app/host/allocate-resources.ts'; allocateResources();"

tsx ./src/app/host/run-enclave.ts

tsx ./src/app/host/run-host-ceremony.ts '/home/ec2-user/nitro-pinky-swear/tests/circuit.circom'

sudo nitro-cli console --enclave-id "ID"

sudo nitro-cli describe-enclaves

sudo nitro-cli terminate-enclave --enclave-id "ID"

## fresh server script notes
chmod +x /home/ec2-user/nitro-pinky-swear/scripts/fresh-server-script.sh
./scripts/fresh-server-script.sh
