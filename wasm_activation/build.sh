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

# Pin wasm-pack to last version compatible with Rust stable (1.87).
# wasm-pack 0.14.0 pulls dependencies requiring Rust 1.88+.
WASM_PACK_VERSION="0.13.1"

# Function to check and install/update wasm-pack to the pinned version
check_and_update_wasm_pack() {
    if ! command -v wasm-pack &> /dev/null; then
        echo "wasm-pack not found. Installing v${WASM_PACK_VERSION}..."
        cargo install wasm-pack --version "$WASM_PACK_VERSION" --locked
        return
    fi

    # Get the currently installed version
    local current_version
    current_version=$(wasm-pack --version 2>/dev/null | grep -oE '[0-9]+\.[0-9]+\.[0-9]+' || echo "0.0.0")

    echo "Current wasm-pack version: $current_version"
    echo "Required wasm-pack version: $WASM_PACK_VERSION"

    # Compare versions and update if needed
    if [ "$current_version" != "$WASM_PACK_VERSION" ]; then
        echo "Updating wasm-pack from $current_version to $WASM_PACK_VERSION..."
        cargo install wasm-pack --version "$WASM_PACK_VERSION" --force --locked
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

# Treat warnings as errors (align with NEAT-AI-Discovery quality.sh).
# SIMD flags (+simd128,+relaxed-simd) are set in .cargo/config.toml for
# wasm32-unknown-unknown only, to avoid "not a recognized feature for this
# target" when Cargo builds host crates (build scripts, procedural macros).
export RUSTFLAGS="-D warnings"

# Pre-install wasm-bindgen-cli with --locked so wasm-pack doesn't attempt an
# unlocked install that may pull incompatible transitive deps (e.g. time >=0.3.47
# requiring Rust 1.88+).
ensure_wasm_bindgen_cli() {
    local wb_version
    wb_version=$(sed -n 's/^wasm-bindgen = "[=~^]*\([0-9][0-9.]*\)".*/\1/p' Cargo.toml | head -1)
    if [ -z "$wb_version" ]; then
        return
    fi

    # wasm-pack caches wasm-bindgen-cli here; if the binary exists it skips install.
    local cache_root=""
    if [[ "$OSTYPE" == darwin* ]]; then
        cache_root="$HOME/Library/Caches/.wasm-pack"
    else
        cache_root="${XDG_CACHE_HOME:-$HOME/.cache}/.wasm-pack"
    fi
    local cache_dir="$cache_root/.wasm-bindgen-cargo-install-$wb_version"
    local bin_path="$cache_dir/bin/wasm-bindgen"

    if [[ -x "$bin_path" ]]; then
        echo "wasm-bindgen-cli $wb_version already cached."
        return
    fi

    echo "Pre-installing wasm-bindgen-cli $wb_version (--locked)..."
    cargo install wasm-bindgen-cli --version "$wb_version" --locked --root "$cache_dir"
}

# Build the WASM module with wasm-pack (preferred) or cargo
if command -v wasm-pack &> /dev/null; then
    ensure_wasm_bindgen_cli
    echo "Using wasm-pack for build (with SIMD enabled)..."
    wasm-pack build --target web --release --out-dir pkg
else
    echo "wasm-pack not found, using cargo + wasm-bindgen-cli..."

    # Ensure wasm-bindgen-cli is installed
    if ! command -v wasm-bindgen &> /dev/null; then
        echo "Installing wasm-bindgen-cli..."
        cargo install wasm-bindgen-cli --locked
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
    echo "$FINGERPRINT" > pkg/build-fingerprint
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
!build-fingerprint

# If wasm-pack emits snippets/, keep them too.
!snippets/
!snippets/**
EOF

ls -la pkg/
