#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v deno >/dev/null 2>&1; then
  echo "ERROR: deno is required to read deno.json" >&2
  exit 1
fi

read_config() {
  deno eval '
const config = JSON.parse(Deno.readTextFileSync("deno.json"));
const repo = config.neatCore?.repo;
const rev = config.neatCore?.rev;
if (typeof repo !== "string" || repo.length === 0) {
  console.error("deno.json missing neatCore.repo");
  Deno.exit(2);
}
if (!/^[0-9a-f]{40}$/.test(String(rev ?? ""))) {
  console.error("deno.json missing neatCore.rev (40-char sha)");
  Deno.exit(3);
}
console.log(`${repo}\n${rev}`);
'
}

cfg_output="$(read_config)"
NEAT_CORE_REPO_DEFAULT="$(printf '%s\n' "$cfg_output" | sed -n '1p')"
NEAT_CORE_REV_DEFAULT="$(printf '%s\n' "$cfg_output" | sed -n '2p')"

NEAT_CORE_REPO="${NEAT_CORE_REPO:-$NEAT_CORE_REPO_DEFAULT}"
NEAT_CORE_REV="${NEAT_CORE_REV:-$NEAT_CORE_REV_DEFAULT}"

if ! [[ "$NEAT_CORE_REV" =~ ^[0-9a-f]{40}$ ]]; then
  echo "ERROR: NEAT_CORE_REV must be a 40-character hex sha" >&2
  exit 1
fi

ARCHIVE_URL="${NEAT_CORE_ARCHIVE_URL:-https://codeload.github.com/${NEAT_CORE_REPO}/tar.gz/${NEAT_CORE_REV}}"
DEST_DIR="wasm_activation/pkg"

tmpdir="$(mktemp -d -t neat-ai-core.XXXXXX)"
trap 'rm -rf "$tmpdir"' EXIT

echo "Downloading NEAT-AI-core archive for ${NEAT_CORE_REPO}@${NEAT_CORE_REV}..."
curl_args=(-fsSL)
if [[ -n "${NEAT_CORE_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
  token="${NEAT_CORE_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
  curl_args+=(-H "Authorization: Bearer ${token}")
fi
curl "${curl_args[@]}" "$ARCHIVE_URL" -o "$tmpdir/core.tar.gz"
tar -xzf "$tmpdir/core.tar.gz" -C "$tmpdir"

matches=("$tmpdir"/NEAT-AI-core-*/wasm_activation/pkg)
src_pkg_dir=""
if [[ ${#matches[@]} -gt 0 && -d "${matches[0]}" ]]; then
  src_pkg_dir="${matches[0]}"
  rm -rf "$DEST_DIR"
  mkdir -p "$DEST_DIR"
  cp -R "$src_pkg_dir"/. "$DEST_DIR"/
else
  echo "WARNING: wasm_activation/pkg not found in NEAT-AI-core archive." >&2
  echo "Using existing local $DEST_DIR if valid." >&2
fi

required=(
  "wasm_activation.js"
  "wasm_activation_bg.wasm"
  "wasm_activation.d.ts"
  "wasm_activation_bg.wasm.d.ts"
)
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
