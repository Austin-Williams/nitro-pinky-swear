#!/usr/bin/env bash
set -euo pipefail

# These env-vars are supplied by the outer build script
: "${DOCKER_URI:?need DOCKER_URI}" # e.g. enclave:latest
: "${OUTPUT_FILE:?need OUTPUT_FILE}" # e.g. /workspace/enclave.eif

echo "▶ Building EIF from $DOCKER_URI ..."
nitro-cli build-enclave \
  --docker-uri  "$DOCKER_URI" \
  --output-file "$OUTPUT_FILE"

echo "  EIF written to $OUTPUT_FILE"

EIF_SIZE=$(stat -c%s "$OUTPUT_FILE")
echo "  EIF size: $(awk "BEGIN {printf \"%.2f\", ${EIF_SIZE}/1024/1024}") MB"
