#!/usr/bin/env bash
# docker/enclave/run.sh
#
# Entrypoint for the Nitro Enclave container.
#   • Sets NODE_ENV=production
#   • Runs the TypeScript entry-point with `tsx`
#   • If the script ever exits non-zero, we exit the container
#     so the enclave manager knows something went wrong.

set -euo pipefail

cd /app

export NODE_ENV=production
export NODE_OPTIONS="${NODE_OPTIONS:-} --no-warnings"
export PATH="/app/node_modules/.bin:$PATH"  # ensure local binaries like 'tsx' are found

echo "[run.sh] launching enclave ceremony with tsx …"
exec tsx ./src/app/enclave/run-enclave-ceremony.ts
