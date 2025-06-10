#!/bin/bash

# This script is intended to be run on an ARM64/Graviton EC2 instance with AWS Nitro Enclaves enabled.

# Set up logging to both console and file
LOG_FILE="$HOME/run-ceremony-$(date +%Y%m%d-%H%M%S).log"
exec > >(tee -a "$LOG_FILE") 2>&1
echo "Logging all output to $LOG_FILE"

# Ensure this script is not run as root initially
if [ "$(id -u)" -eq 0 ]; then
  echo "This script should be run as ec2-user, not as root." >&2
  echo "It will use 'sudo' internally for commands that require root privileges." >&2
  exit 1
fi

# Ensure we are on ARM64/Graviton EC2 instance
ARCH=$(uname -m)
if [ "$ARCH" != "aarch64" ]; then
  echo "Error: This script is intended for ARM64 (aarch64) architecture (e.g., AWS Graviton instances)." >&2
  echo "Detected architecture: $ARCH" >&2
  exit 1
else
  echo "Correct architecture (aarch64) detected."
fi

# Check if a file named circuit.circom exists in the job directory
if [ ! -f "$HOME/job/circuit.circom" ]; then
	echo "Error: circuit.circom not found in $HOME/job directory. Please check the file was uploaded correctly. Exiting." >&2
	exit 1
fi

# Install git
if ! command -v git &> /dev/null; then
    echo "Installing git..."
    sudo dnf install -y git
    echo "git installed."
else
    echo "git is already installed."
fi

# Clone the nitro-pinky-swear repo
cd $HOME
git clone https://github.com/Austin-Williams/nitro-pinky-swear.git
cd $HOME/nitro-pinky-swear

# Define the ceremony directory path consistently
CEREMONY_DIR="$HOME/nitro-pinky-swear/ceremony"

# Create ceremony directory if it doesn't exist
mkdir -p "$CEREMONY_DIR"
chmod 755 "$CEREMONY_DIR"

# Create artifacts directory if it doesn't exist
mkdir -p "$CEREMONY_DIR/artifacts"
chmod 755 "$CEREMONY_DIR/artifacts"

# Copy the circuit file to the ceremony directory
cp "$HOME/job/circuit.circom" "$CEREMONY_DIR/circuit.circom"

# Install development tools including gcc compiler
echo "Installing development tools (gcc, make, etc.)..."
sudo dnf groupinstall -y "Development Tools"
echo "Development tools installed."

# Install AWS Nitro CLI tools
echo "Installing AWS Nitro CLI tools..."
sudo dnf install -y aws-nitro-enclaves-cli aws-nitro-enclaves-cli-devel
echo "AWS Nitro CLI tools installed."

# Install Docker using the Amazon Linux 2023 method
echo "Installing Docker..."
sudo dnf install -y docker
sudo systemctl enable docker
echo "Pausing for 4 seconds..."
sleep 4
sudo systemctl start docker
echo "Pausing for 4 seconds..."
sleep 4
sudo usermod -aG docker ec2-user
echo "Docker installed and started."

# Check if rustc 1.75.x is installed
if command -v rustc >/dev/null 2>&1; then
    RUST_VERSION=$(rustc --version | awk '{print $2}')
    if [[ "$RUST_VERSION" == 1.75* ]]; then
        echo "Rust $RUST_VERSION is already installed."
    else
        echo "Rust version $RUST_VERSION found, but 1.75.x is required. Installing Rust 1.75..."
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.75
        source $HOME/.cargo/env
    fi
else
    echo "Rust is not installed. Installing Rust 1.75..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y --default-toolchain 1.75
    source $HOME/.cargo/env
fi

# Check if circom v2.2.2 is installed, and if not then install it (commit de2212a7aa6a070c636cc73382a3deba8c658ad5)
echo "Checking circom installation..."
CIRCOM_VERSION_REQUIRED="2.2.2"
CIRCOM_COMMIT="de2212a7aa6a070c636cc73382a3deba8c658ad5"
CIRCOM_BIN="$(command -v circom || true)"
CIRCOM_OK=0

if [ -n "$CIRCOM_BIN" ]; then
    CIRCOM_VERSION_OUTPUT="$($CIRCOM_BIN --version 2>&1)"
    if echo "$CIRCOM_VERSION_OUTPUT" | grep -q "$CIRCOM_VERSION_REQUIRED"; then
        echo "circom v$CIRCOM_VERSION_REQUIRED is already installed."
        CIRCOM_OK=1
    fi
fi

if [ "$CIRCOM_OK" -ne 1 ]; then
    echo "Installing circom v$CIRCOM_VERSION_REQUIRED at commit $CIRCOM_COMMIT..."
    rm -rf /tmp/circom
    git clone https://github.com/iden3/circom.git /tmp/circom
    cd /tmp/circom
    git checkout $CIRCOM_COMMIT
    cargo build --release
    sudo cp target/release/circom /usr/local/bin/
    cd /
    rm -rf /tmp/circom
    echo "circom v$CIRCOM_VERSION_REQUIRED installed."
fi

cd $HOME/nitro-pinky-swear

# Check if Node.js v18 is installed, and if not then install it
REQUIRED_NODE_MAJOR="18"
NODE_BIN="$(command -v node || true)"
NODE_OK=0

if [ -n "$NODE_BIN" ]; then
    NODE_VERSION_OUTPUT="$($NODE_BIN --version 2>&1)"
    NODE_MAJOR=$(echo "$NODE_VERSION_OUTPUT" | sed 's/v\([0-9]*\).*/\1/')
    if [ "$NODE_MAJOR" = "$REQUIRED_NODE_MAJOR" ]; then
        echo "Node.js v$NODE_MAJOR is already installed."
        NODE_OK=1
    fi
fi

if [ "$NODE_OK" -ne 1 ]; then
     echo "Installing Node.js v$REQUIRED_NODE_MAJOR..."
    # Remove existing Node.js packages to avoid conflicts
    sudo dnf remove -y nodejs nodejs-npm nodejs-full-i18n || true
    # Set up NodeSource repository for Node.js 18.x
    curl -fsSL https://rpm.nodesource.com/setup_18.x | sudo bash -
    # Install Node.js 18 with options to force installation even if it requires replacing packages
    sudo dnf install -y --best --allowerasing nodejs
     echo "Node.js v$REQUIRED_NODE_MAJOR installed."
 fi

# Install node packages
cd $HOME/nitro-pinky-swear
npm install

# build the eif (requires sudo)
echo "Building EIF..."
sudo ./scripts/build-eif.sh

# Check if the EIF build was successful before proceeding
EIF_PATH="$CEREMONY_DIR/enclave.eif"
if [ ! -f "$EIF_PATH" ]; then
    echo "Error: EIF file '$EIF_PATH' not found after build. Exiting." >&2
    exit 1
fi  
echo "EIF build completed."

npx tsx 'src/app/host/run-host-ceremony.ts' "$CEREMONY_DIR/circuit.circom"

echo "Host ceremony script completed."

# Move all artifacts from $HOME/nitro-pinky-swear/ceremony/artifacts/ to $HOME/job/out/
echo "Moving ceremony artifacts to job output directory..."
# Create output directory if it doesn't exist
mkdir -p "$HOME/job/out"

# Copy all artifacts to the output directory
cp -r "$CEREMONY_DIR/artifacts/"* "$HOME/job/out/"

