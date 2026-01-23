#!/bin/bash
# Build script for WASM activation module
# Issue #1116 - WASM prototype for creature activation
# Issue #1166 - Auto-update wasm-pack to latest version

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

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

# Check and update wasm-pack before building
check_and_update_wasm_pack

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
