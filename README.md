> THIS REPO IS UNDER VERY ACTIVE DEVELOPMENT AND IS EXTREMELY UNSTABLE. DO NOT BOTHER TRYING TO CONTRIBUTE OR USE IT YET.

# nitro-pinky-swear
Runs a Groth16 trusted-setup ceremony using SnarkJS inside a TEE (AWS Nitro Enclave) and verifies the remote attestation. If you trust AWS Nitro Enclaves, you can trust that the toxic waste from the ceremony was securely deleted and never accessible.

> "I deleted that toxic waste. I pinky swear." - AWS Nitro Secure Module, basically.

## Requirements
- Node.js v18+
- [AWS CLI v2](https://docs.aws.amazon.com/cli/latest/userguide/getting-started-install.html)
- IAM user or role with these permission policies:
	- AmazonEC2FullAccess
	- AmazonS3FullAccess
	- AmazonSSMFullAccess
	- AWSCloudFormationFullAccess
	- IAMFullAccess
- AWS credentials for the above IAM user or role in `.env`
	- `AWS_ACCESS_KEY_ID`
	- `AWS_SECRET_ACCESS_KEY`
	- `AWS_SESSION_TOKEN` (if using temporary creds)
	- `AWS_REGION` (optional, defaults to `us-east-1`)

## Usage
- clone this repo
- create `.env` with AWS credentials
- `npm install`
- name your .circom file `circuit.circom`
- Then run the following:
```
npx --no-install tsx ./src/aws/infra.ts --run-job \
	--script ./scripts/run-ceremony.sh \
	--file <path/to/your/circuit.circom>
```
This command will:
- Spin up an EC2 instance with a Nitro Enclave
- Upload your circuit file
- Run the Groth16 trusted-setup ceremony between the host and the enclave using SnarkJS
	- The host creates the initial zkey using the Powers of Tau.
	- The enclave contributes its own secret randomness ("toxic waste") and immediately forgets it.
	- A random beacon from the [League of Entropy](https://www.drand.love/loe) -- provably generated after the enclave's contribution -- is used to generate the final zkey.
- Download all ceremony artifacts to your local machine
	- attestations
	- zkey
	- random beacon signed by Leage of Entropy
	- log output of the enclave
	- log output of the host
	- r1cs file
	- wasm file
	- solidity verifier, creation code, and extcodehash
	- hashes of all files used in the ceremony
	- etc
- Tear down the EC2 instance

## TODO
- Post-ceremony verification script that verifies ceremony integrity using the ceremony artifacts
- Make the .EIF build reproducible

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

## One-shot ceremony
npx --no-install tsx ./src/aws/infra.ts --run-job \
	--script ./scripts/run-ceremony.sh \
	--file ./tests/circuit.circom
