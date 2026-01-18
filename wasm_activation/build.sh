#!/bin/bash
# Build script for WASM activation module
# Issue #1116 - WASM prototype for creature activation

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "Building WASM activation module..."

# Build the WASM module with wasm-pack (preferred) or cargo
if command -v wasm-pack &> /dev/null; then
    echo "Using wasm-pack for build..."
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
ls -la pkg/
