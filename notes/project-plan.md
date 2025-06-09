## project plan

### One-time project setup
I host an "S3 One Zone-IA requester-pays bucket" for the project in us-east-1 with all the ptau files (2**26 and lower). This makes it super fast for user instances to geet the ptau files they need. The user checks the hash in their own enclave, so they don't need to trust me, and the parent process falls back to downloading the file from StarkJs's google links if they can't get it from my S3 bucket.


### Local computer
Runs docker container for consistency.
Pre-flight test: compiles .circom circuit and checks circuit size is at most 2**26
Spins up the EC2 instance and waits for it to be ready
Runs the parent process on the EC2 instance
Waits until parent process is complete
Downloads the output artifacts from via S3, (zkey, attestation document, etc)
Tears down the infra
Confirms it has stopped (no ongoing charges)
Verifies the artifacts locally
Done.

### Parent process on EC2 host
Runs docker container for consistency.
Uses snarkjs to compile .circom circuit
Detects (from circuit size) which ptau file to download
Downloads the ptau file and verifies hash (just a pre-flight check, the real check that matters happens inside the enclave)
does snarkjs `zkey new` outside the enclave (peaks memory at 5x the ptau file size)
Starts the enclave workload (sets paging properly for large memory use)
Passes the enclave the .circom file, 0000.zkey, and the ptau file
Waits for enclave to pass first attestation document over vsock (attests to 0001.zkey hash and timestamp)
Parses the first attestation document to get the timestamp
uses the timestamp to deterministically compute the correct drand round
while waiting for the drand round, it feteches the certchain for the attestation and passes it to the enclave over vsock
waits until that drand round is available and downloads it
passes the drandround to the enclave over vsock

waits for the enclave to pass final.zkey, final attestation document, and all other artifacts over vsock. The second attestation covers all artifacts-- hashes of: .circom, 0001.zkey, first attestation, final.zkey, ptau, drand round, any other artifacts (extra cool if it could also do hash of the verification contract code, like exactly what a contact would see if it did `type(ContractName).runtimeCode` on chain).

ships all the artifacts to s3
Tears down the enclave
Waits patiently to be shutdown by cloudformation

### Enclave workload
Docker Image (“enclave workload”)
Has Rust, circom, and snarkjs installed (node_modules present, etc). No downloading needed.
Start up, checks its own env to make sure it is safe (see ToB references): random sources specifically
Gets the .circom file, 0000.zkey, and the ptau file from the parent over vsock
compiles the .circom file
Verifies the ptau file hash
verifies 0000.zkey using SnarkJS and the verified ptau file
contributes to create 0001.zkey
deletes the 0000.zkey to free up space
verifies the 0001.zkey using SnarkJS and the verified ptau file (catches any errors early)
Computes the hash of the 0001.zkey and uses it as the nonce when asking for a first attestation
passes a copy of that first attestation to the parent process over vsock
waits to receive the cert chain from the parent process over vsock
verifies the cert chain against the root key (which is pinned as part of the .eif image)
verifies the signature over the attestation is valid for the cert chain
parses the attestation to get the timestamp
uses the timestamp to deterministically compute the correct drand round
waits for the drand round to come in from the parent over vsock
verifies the drand round signature (just to fail early on bad sig)
verifies the drand round number is correct
uses the drand value as the beacon to create the final.zkey
deletes 0001.zkey to free up space
verifies the final.zkey using SnarkJS and the verified ptau file
Commits to the outputs (hashes of the artifacts), and uses that as the nonce when asking for a final attestation
passes a copy of that final attestation and all outputs to the parent process over vsock
Done.

## possible future additions
GitHub Action to run the ceremony automatically
