#!/bin/bash
# Build script for WASM activation module
# Issue #1116 - WASM prototype for creature activation
# Issue #1166 - Auto-update wasm-pack to latest version
# Issue #1489 - Learnings from NEAT-AI-Discovery runlib.sh

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# Source shared Rust toolchain validation
# shellcheck source=../scripts/rustlib.sh
source "$SCRIPT_DIR/../scripts/rustlib.sh"

echo "Building WASM activation module..."

# Function to check and update wasm-pack to the latest version
check_and_update_wasm_pack() {
    if ! command -v wasm-pack &> /dev/null; then
        echo "wasm-pack not found. Installing latest version..."
        cargo install wasm-pack
        return
    fi

    echo "Checking for wasm-pack updates..."

    # Get the currently installed version
    local current_version
    current_version=$(wasm-pack --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "0.0.0")

    # Get the latest version from crates.io
    local latest_version
    latest_version=$(cargo search wasm-pack --limit 1 2>/dev/null | grep -oE '"[0-9]+\.[0-9]+\.[0-9]+"' | tr -d '"' || echo "")

    if [ -z "$latest_version" ]; then
        echo "Could not determine latest wasm-pack version. Using current installation."
        return
    fi

    echo "Current wasm-pack version: $current_version"
    echo "Latest wasm-pack version:  $latest_version"

    # Compare versions and update if needed
    if [ "$current_version" != "$latest_version" ]; then
        echo "Updating wasm-pack from $current_version to $latest_version..."
        cargo install wasm-pack --force
        echo "wasm-pack updated successfully."
    else
        echo "wasm-pack is already up to date."
    fi
}

# Ensure Rust toolchain is available and meets minimum version
require_rust_tools

# Ensure the wasm32-unknown-unknown target is installed
if ! rustup target list --installed 2>/dev/null | grep -q wasm32-unknown-unknown; then
    echo "Adding wasm32-unknown-unknown target..." >&2
    rustup target add wasm32-unknown-unknown >&2
fi

# Check and update wasm-pack before building
check_and_update_wasm_pack

# Issue #1178 - Enable SIMD support for WASM
# simd128 enables 128-bit SIMD operations for vectorized activation
# Issue #1197 - Enable relaxed-simd for FMA (fused multiply-add) optimization
export RUSTFLAGS="-C target-feature=+simd128,+relaxed-simd"

# Build the WASM module with wasm-pack (preferred) or cargo
if command -v wasm-pack &> /dev/null; then
    echo "Using wasm-pack for build (with SIMD enabled)..."
    wasm-pack build --target web --release --out-dir pkg
else
    echo "wasm-pack not found, using cargo + wasm-bindgen-cli..."

    # Ensure wasm-bindgen-cli is installed
    if ! command -v wasm-bindgen &> /dev/null; then
        echo "Installing wasm-bindgen-cli..."
        cargo install wasm-bindgen-cli
    fi

    # Build with cargo
    cargo build --target wasm32-unknown-unknown --release

    # Create output directory
    mkdir -p pkg

    # Generate JS bindings with wasm-bindgen
    wasm-bindgen \
        --target web \
        --out-dir pkg \
        target/wasm32-unknown-unknown/release/wasm_activation.wasm
fi

# Optimise the WASM if wasm-opt is available
if command -v wasm-opt &> /dev/null; then
    echo "Optimising WASM with wasm-opt..."
    wasm-opt -O3 -o pkg/wasm_activation_bg_opt.wasm pkg/wasm_activation_bg.wasm
    mv pkg/wasm_activation_bg_opt.wasm pkg/wasm_activation_bg.wasm
fi

echo "Build complete. Output in pkg/"

# Compute a stable fingerprint of the WASM inputs so CI can skip rebuilding
# when nothing in the Rust/WASM sources changed.
#
# Note: we avoid `git` so this works for consumers building from a source tarball.
compute_fingerprint() {
    local hasher=""
    if command -v sha256sum &> /dev/null; then
        hasher="sha256sum"
    elif command -v shasum &> /dev/null; then
        hasher="shasum -a 256"
    else
        echo "WARN: no sha256sum/shasum available; fingerprint disabled" >&2
        return 1
    fi

    # Hash the key input files. Keep this list small and stable.
    # (If you add more Rust files, update this list.)
    cat Cargo.toml src/lib.rs build.sh | eval "$hasher" | awk '{print $1}'
}

# Write fingerprint file for workflow guards.
FINGERPRINT="$(compute_fingerprint || echo "")"
if [[ -n "$FINGERPRINT" ]]; then
    echo "$FINGERPRINT" > pkg/.build-fingerprint
fi

# wasm-bindgen/wasm-pack occasionally emits duplicate `export const <name>` entries
# in `wasm_activation_bg.wasm.d.ts`, which breaks `deno check` with TS2451.
# We de-duplicate those declarations deterministically.
dedupe_wasm_d_ts() {
    local infile="pkg/wasm_activation_bg.wasm.d.ts"
    local outfile="pkg/wasm_activation_bg.wasm.d.ts.tmp"
    if [[ ! -f "$infile" ]]; then
        return 0
    fi

    awk '
      BEGIN { skip=0 }
      # If we are skipping a multi-line duplicate block, drop lines until the terminating semicolon.
      skip==1 {
        if ($0 ~ /;/) { skip=0 }
        next
      }
      # Match export const NAME: ... (portable awk)
      $0 ~ /^export const [A-Za-z0-9_]+:/ {
        line=$0
        sub(/^export const /, "", line)
        sub(/:.*/, "", line)
        name=line
        if (seen[name]++ > 0) {
          # Skip this line and, if it starts a multi-line declaration, skip until semicolon.
          if ($0 !~ /;$/) { skip=1 }
          next
        }
      }
      { print }
    ' "$infile" > "$outfile" && mv "$outfile" "$infile"
}

dedupe_wasm_d_ts

# Ensure pkg/.gitignore allows committing the built artefacts.
# wasm-pack may recreate/overwrite pkg/.gitignore; we enforce the repo policy here
# so CI can commit the generated files back to PR branches.
cat > pkg/.gitignore <<'EOF'
*
!.gitignore

# Commit the built WASM artefacts so consumers (and CI on Develop) don't need Rust.
!package.json
!wasm_activation.js
!wasm_activation.d.ts
!wasm_activation_bg.wasm
!wasm_activation_bg.wasm.d.ts
!.build-fingerprint

# If wasm-pack emits snippets/, keep them too.
!snippets/
!snippets/**
EOF

ls -la pkg/
