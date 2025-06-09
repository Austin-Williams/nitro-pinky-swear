# EIF Builder

The `eif-builder` docker container is used to build enclave image files (EIFs) for AWS Nitro Enclaves.

Nitro enclaves run EIF files, which are built from docker containers using the `aws-nitro-enclaves-cli` tool.

The `aws-nitro-enclaves-cli` tool is linux-only, so we use the `eif-builder` docker container to build the EIF files for us.

## Usage

Your enclave app Dockerfile should live at `docker/enclave/Dockerfile`. This is the code that will ultimately be run inside the enclave.

The `build-eif.sh` script builds your enclave app docker container and then converts it into an `enclave.eif` file that will appear in the `docker/enclave` directory.

From your project's root directory, make the script executable and run it:

```bash
# Make sure docker is running
sudo systemctl start docker # Start the docker daemon if it's not already running

# Make the build-eif.sh script executable and run it
chmod +x ./docker/build-eif.sh
sudo ./docker/build-eif.sh

# Stop the docker daemon if you want to
sudo systemctl stop docker
```

Your `enclave.eif` file should now be in the `ceremony/` directory.

