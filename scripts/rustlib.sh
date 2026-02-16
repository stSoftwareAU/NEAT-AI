#!/usr/bin/env bash
# Shared Rust toolchain validation and setup.
# Inspired by NEAT-AI-Discovery scripts/runlib.sh (Issue #1489).
#
# Source this file from other scripts:
#   source "$(dirname "${BASH_SOURCE[0]}")/../scripts/rustlib.sh"
#   require_rust_tools
set -euo pipefail

# Minimum rustc version required by the WASM build toolchain.
RUST_MSRV="${RUST_MSRV:-1.82.0}"

# Returns 0 if v1 >= v2 (semver-style), 1 otherwise.
_version_ge() {
  local v1="$1" v2="$2"
  local IFS=.
  local i
  local -a a b
  a=(${v1%%-*})  # strip any -pre suffix
  b=(${v2%%-*})
  for ((i=0; i<${#a[@]} || i<${#b[@]}; i++)); do
    local x=${a[i]:-0} y=${b[i]:-0}
    ((10#$x > 10#$y)) && return 0
    ((10#$x < 10#$y)) && return 1
  done
  return 0
}

# Ensure Rust toolchain and build dependencies are available.
# Mirrors the _require_tools() pattern from NEAT-AI-Discovery runlib.sh.
require_rust_tools() {
  export PATH="$HOME/.cargo/bin:$PATH"

  # On Linux, check for build tools (gcc/cc) needed for Rust compilation
  if [[ "$(uname -s)" == "Linux" ]]; then
    if ! command -v cc >/dev/null 2>&1 && ! command -v gcc >/dev/null 2>&1; then
      echo "ERROR: Build tools (gcc/cc) not found." >&2
      echo "" >&2
      if command -v apt-get >/dev/null 2>&1; then
        echo "  For Ubuntu/Debian:" >&2
        echo "    sudo apt-get update && sudo apt-get install -y build-essential" >&2
      elif command -v yum >/dev/null 2>&1; then
        echo "  For RHEL/CentOS/Amazon Linux:" >&2
        echo "    sudo yum groupinstall -y \"Development Tools\"" >&2
      elif command -v dnf >/dev/null 2>&1; then
        echo "  For Fedora:" >&2
        echo "    sudo dnf groupinstall -y \"Development Tools\"" >&2
      else
        echo "  Please install gcc using your system's package manager." >&2
      fi
      exit 1
    fi
  fi

  # On macOS, check for Xcode Command Line Tools
  if [[ "$(uname -s)" == "Darwin" ]]; then
    if ! command -v cc >/dev/null 2>&1 && ! command -v gcc >/dev/null 2>&1; then
      if [[ ! -d "/Library/Developer/CommandLineTools" ]] && \
         [[ ! -d "/Applications/Xcode.app/Contents/Developer" ]]; then
        echo "WARNING: Build tools (gcc/cc) not found on macOS." >&2
        echo "Attempting to install Xcode Command Line Tools..." >&2
        if xcode-select --install 2>&1; then
          echo "Installation dialog triggered. Please install and re-run." >&2
          exit 1
        fi
      fi
    fi
  fi

  # Install Rust (rustup + cargo) if missing
  if ! command -v cargo >/dev/null 2>&1 || ! command -v rustup >/dev/null 2>&1; then
    echo "Installing Rust (rustup + cargo)..." >&2
    curl --proto "=https" --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    export PATH="$HOME/.cargo/bin:$PATH"
    echo "Rust installed successfully" >&2
  fi

  # Ensure a default toolchain is set
  if ! cargo --version >/dev/null 2>&1; then
    echo "No default Rust toolchain configured. Setting default to stable..." >&2
    rustup default stable >&2 || {
      echo "ERROR: Failed to set default Rust toolchain." >&2
      exit 1
    }
  fi

  # Check Rust version meets minimum
  local rust_ver
  rust_ver="$(rustc --version 2>/dev/null | sed -n 's/^rustc \([0-9]*\.[0-9]*\.[0-9]*\).*/\1/p')"
  if [[ -z "$rust_ver" ]]; then
    echo "WARNING: Could not determine rustc version, skipping version check" >&2
  elif ! _version_ge "$rust_ver" "$RUST_MSRV"; then
    echo "rustc ${rust_ver} is below minimum required (${RUST_MSRV}). Updating toolchain..." >&2
    rustup update stable >&2 || {
      echo "ERROR: Failed to update Rust toolchain." >&2
      exit 1
    }
    rust_ver="$(rustc --version 2>/dev/null | sed -n 's/^rustc \([0-9]*\.[0-9]*\.[0-9]*\).*/\1/p')"
    if ! _version_ge "$rust_ver" "$RUST_MSRV"; then
      echo "ERROR: rustc ${rust_ver} still below ${RUST_MSRV} after update." >&2
      exit 1
    fi
    echo "Rust updated to rustc ${rust_ver}" >&2
  fi
}
