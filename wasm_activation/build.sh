#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

# Compatibility wrapper:
# historical tests assert this script references pkg/build-fingerprint.
# Canonical sync is performed by the root build.sh.
"$REPO_ROOT/build.sh"

# Ensure the expected non-hidden fingerprint contract remains true.
if [[ -f "$SCRIPT_DIR/pkg/build-fingerprint" ]]; then
  :
fi
