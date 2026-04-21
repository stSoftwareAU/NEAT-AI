#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CLEAN=false

show_help() {
  cat <<'HELP'
Usage: ./build.sh [OPTIONS]

Sync/build wasm_activation/pkg from NEAT-AI-core.

Options:
  --clean       Delete wasm_activation/pkg before build
  --help, -h    Show this help and exit
HELP
}

for arg in "$@"; do
  case "$arg" in
    --clean)
      CLEAN=true
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $arg" >&2
      echo "Run './build.sh --help' for usage." >&2
      exit 1
      ;;
  esac
done

if ! command -v deno >/dev/null 2>&1; then
  echo "ERROR: deno is required to read deno.json" >&2
  exit 1
fi

read_config() {
  deno eval '
const config = JSON.parse(Deno.readTextFileSync("deno.json"));
const repo = config.neatCore?.repo;
const ref = config.neatCore?.ref ?? "Develop";
const rev = config.neatCore?.rev ?? "";
if (typeof repo !== "string" || repo.length === 0) {
  console.error("deno.json missing neatCore.repo");
  Deno.exit(2);
}
if (typeof ref !== "string" || ref.length === 0) {
  console.error("deno.json missing neatCore.ref");
  Deno.exit(3);
}
if (rev && !/^[0-9a-f]{40}$/.test(String(rev))) {
  console.error("deno.json neatCore.rev must be 40-char sha when set");
  Deno.exit(4);
}
console.log(`${repo}\n${ref}\n${rev}`);
'
}

cfg_output="$(read_config)"
NEAT_CORE_REPO_DEFAULT="$(printf '%s\n' "$cfg_output" | sed -n '1p')"
NEAT_CORE_REF_DEFAULT="$(printf '%s\n' "$cfg_output" | sed -n '2p')"
NEAT_CORE_REV_DEFAULT="$(printf '%s\n' "$cfg_output" | sed -n '3p')"

NEAT_CORE_REPO="${NEAT_CORE_REPO:-$NEAT_CORE_REPO_DEFAULT}"
NEAT_CORE_REF="${NEAT_CORE_REF:-$NEAT_CORE_REF_DEFAULT}"
NEAT_CORE_REV="${NEAT_CORE_REV:-$NEAT_CORE_REV_DEFAULT}"

curl_args=(-fsSL)
if [[ -n "${NEAT_CORE_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
  token="${NEAT_CORE_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
  curl_args+=(-H "Authorization: Bearer ${token}")
fi

if ! [[ "$NEAT_CORE_REV" =~ ^[0-9a-f]{40}$ ]]; then
  if [[ -z "$NEAT_CORE_REF" ]]; then
    echo "ERROR: NEAT_CORE_REF is required when NEAT_CORE_REV is unset" >&2
    exit 1
  fi
  api_url="https://api.github.com/repos/${NEAT_CORE_REPO}/commits/${NEAT_CORE_REF}"
  echo "Resolving latest commit for ${NEAT_CORE_REPO}@${NEAT_CORE_REF}..."
  commit_json="$(curl "${curl_args[@]}" "$api_url")"
  resolved_rev="$(printf '%s\n' "$commit_json" | sed -nE 's/.*"sha":[[:space:]]*"([0-9a-f]{40})".*/\1/p' | sed -n '1p')"
  if ! [[ "$resolved_rev" =~ ^[0-9a-f]{40}$ ]]; then
    echo "ERROR: Could not resolve commit SHA for ${NEAT_CORE_REPO}@${NEAT_CORE_REF}" >&2
    exit 1
  fi
  NEAT_CORE_REV="$resolved_rev"
fi

ARCHIVE_URL="${NEAT_CORE_ARCHIVE_URL:-https://codeload.github.com/${NEAT_CORE_REPO}/tar.gz/${NEAT_CORE_REV}}"
DEST_DIR="wasm_activation/pkg"
required=(
  "wasm_activation.js"
  "wasm_activation_bg.wasm"
  "wasm_activation.d.ts"
  "wasm_activation_bg.wasm.d.ts"
)

has_valid_pkg=false
if [[ -f "$DEST_DIR/neat_core_rev.txt" ]]; then
  current_rev="$(tr -d '\n\r' < "$DEST_DIR/neat_core_rev.txt")"
  if [[ "$current_rev" == "$NEAT_CORE_REV" ]]; then
    has_all=true
    for file in "${required[@]}"; do
      if [[ ! -f "$DEST_DIR/$file" ]]; then
        has_all=false
        break
      fi
    done
    if [[ "$has_all" == true ]]; then
      has_valid_pkg=true
    fi
  fi
fi

if [ "$CLEAN" = true ]; then
  echo "Cleaning $DEST_DIR before build..."
  rm -rf "$DEST_DIR"
elif [[ "$has_valid_pkg" == true ]]; then
  echo "Skipping build: $DEST_DIR already matches ${NEAT_CORE_REPO}@${NEAT_CORE_REV}"
  exit 0
fi

tmpdir="$(mktemp -d -t .neat-ai-core-build.XXXXXX)"
trap 'rm -rf "$tmpdir"' EXIT

echo "Downloading NEAT-AI-core archive for ${NEAT_CORE_REPO}@${NEAT_CORE_REV}..."
curl "${curl_args[@]}" "$ARCHIVE_URL" -o "$tmpdir/core.tar.gz"
tar -xzf "$tmpdir/core.tar.gz" -C "$tmpdir"

source_roots=("$tmpdir"/NEAT-AI-core-*)
if [[ ${#source_roots[@]} -eq 0 || ! -d "${source_roots[0]}" ]]; then
  echo "ERROR: Could not locate extracted NEAT-AI-core source directory." >&2
  exit 1
fi
source_root="${source_roots[0]}"

if [[ ! -f "$source_root/neat-core/Cargo.toml" ]]; then
  echo "ERROR: NEAT-AI-core source is missing neat-core/Cargo.toml." >&2
  echo "Cannot build WASM from Rust-only source without neat-core crate." >&2
  exit 1
fi

echo "Building WASM from Rust-only NEAT-AI-core source..."
if ! command -v wasm-pack >/dev/null 2>&1; then
  if [[ "${NEAT_RUST_DISCOVERY_OPTIONAL:-false}" == "true" ]]; then
    echo "WARNING: wasm-pack not found. Skipping WASM build (NEAT_RUST_DISCOVERY_OPTIONAL=true)." >&2
    exit 0
  fi
  echo "ERROR: wasm-pack is required to build WASM from NEAT-AI-core Rust source." >&2
  exit 1
fi

wrapper_dir="$tmpdir/neat-ai-core-wasm-wrapper"
mkdir -p "$wrapper_dir/src"
cat > "$wrapper_dir/Cargo.toml" <<EOF
[package]
name = "neat_ai_core_wasm_wrapper"
version = "0.1.0"
edition = "2021"

[lib]
crate-type = ["cdylib"]

[dependencies]
wasm-bindgen = "0.2.118"
neat-core = { path = "$source_root/neat-core" }
EOF

cat > "$wrapper_dir/src/lib.rs" <<'EOF'
use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub fn core_wasm_wrapper_ready() -> bool {
    // Keep a direct reference so API mismatches fail at compile-time.
    let _ = neat_core::SquashType::Identity;
    true
}
EOF

mkdir -p "$source_root/wasm_activation/pkg"
(
  cd "$wrapper_dir"
  wasm-pack build --target web --release \
    --out-dir "$source_root/wasm_activation/pkg" \
    --out-name wasm_activation
)

pkg_matches=("$source_root"/wasm_activation/pkg)
if [[ ${#pkg_matches[@]} -eq 0 || ! -d "${pkg_matches[0]}" ]]; then
  echo "ERROR: WASM build did not produce wasm_activation/pkg in NEAT-AI-core source." >&2
  exit 1
fi
src_pkg_dir="${pkg_matches[0]}"

rm -rf "$DEST_DIR"
mkdir -p "$DEST_DIR"
cp -R "$src_pkg_dir"/. "$DEST_DIR"/

for file in "${required[@]}"; do
  if [[ ! -f "$DEST_DIR/$file" ]]; then
    echo "ERROR: missing expected wasm artifact: $DEST_DIR/$file" >&2
    exit 1
  fi
done

printf '%s\n' "$NEAT_CORE_REV" > "$DEST_DIR/neat_core_rev.txt"
# Keep compatibility with existing tests and tooling that assert this file exists.
if command -v shasum >/dev/null 2>&1; then
  fingerprint_input="${NEAT_CORE_REPO}@${NEAT_CORE_REV}"
  printf '%s' "$fingerprint_input" | shasum -a 256 | awk '{print $1}' \
    > "$DEST_DIR/build-fingerprint"
fi

echo "WASM pkg synced to $DEST_DIR from ${NEAT_CORE_REPO}@${NEAT_CORE_REV}"
