#!/usr/bin/env bash
set -euo pipefail

# --- constants ----------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
ENCLAVE_DIR="$SCRIPT_DIR/../docker/enclave"
BUILDER_DIR="$SCRIPT_DIR/../docker/eif-builder"
CEREMONY_DIR="$PROJECT_ROOT/ceremony"
APP_TAG="enclave:latest"
EIF_FILE="enclave.eif"
BUILDER_TAG="eif-builder"

sudo systemctl start docker

# Detect host architecture so we build the right variant
case "$(uname -m)" in
  arm64|aarch64) PLATFORM="linux/arm64" ;;
  *)             PLATFORM="linux/amd64" ;;
esac

echo "▶ Building eif-builder image…"
docker build -t "$BUILDER_TAG" "$BUILDER_DIR"

echo "▶ Building application image ($APP_TAG)…"
docker buildx build --platform "$PLATFORM" --load \
  -f "$ENCLAVE_DIR/Dockerfile" \
  -t "$APP_TAG" "$SCRIPT_DIR/.."

# Ensure the target directory for the EIF exists on the host
mkdir -p "$CEREMONY_DIR"
chmod 777 "$CEREMONY_DIR"

echo "▶ Creating EIF (${EIF_FILE}) in $CEREMONY_DIR ..."
docker run --rm --privileged \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v "$CEREMONY_DIR":/workspace \
  --platform "$PLATFORM" \
  -e DOCKER_URI="$APP_TAG" \
  -e OUTPUT_FILE="/workspace/$EIF_FILE" \
  "$BUILDER_TAG"

echo "✅ Done!  $(realpath "$CEREMONY_DIR/$EIF_FILE")"
