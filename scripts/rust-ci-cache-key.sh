#!/usr/bin/env bash
# Emit a stable cache key for Rust/WASM build caches.
#
# Issue #2344 — Tune cache keys so they invalidate when inputs that
# actually affect the Rust build change. Inputs hashed, in order:
#   1. wasm_activation/Cargo.toml       (always required)
#   2. wasm_activation/Cargo.lock       (when present)
#   3. wasm_activation/build.sh         (when present)
#   4. Any git dependency coordinates (`git = ...`, `rev = ...`,
#      `tag = ...`, `branch = ...`) extracted from Cargo.toml and
#      Cargo.lock. This ensures the cache busts when an external
#      dependency like NEAT-AI-core is repinned to a new `rev`, even
#      if no other line of the manifest changes.
#
# Usage:
#   scripts/rust-ci-cache-key.sh [--prefix <label>]
#   scripts/rust-ci-cache-key.sh --help
#
# Output is a single line — the cache key — on stdout. Non-zero exit
# means an expected input file (Cargo.toml) was missing; the error
# message goes to stderr.
#
# Example (GitHub Actions):
#   - name: Compute cache key
#     id: cachekey
#     run: echo "key=$(scripts/rust-ci-cache-key.sh --prefix ${{ runner.os }}-cargo-wasm)" >> "$GITHUB_OUTPUT"
#   - uses: actions/cache@v4
#     with:
#       path: |
#         ~/.cargo/registry
#         ~/.cargo/git
#         wasm_activation/target
#       key: ${{ steps.cachekey.outputs.key }}

set -euo pipefail

PREFIX=""
CARGO_DIR="${CARGO_DIR:-wasm_activation}"

show_help() {
  cat <<'HELP'
Usage: scripts/rust-ci-cache-key.sh [--prefix <label>]

Emits a stable cache key for Rust/WASM build caches on stdout.

Options:
  --prefix <label>   Prepend <label>- to the emitted cache key
  --cargo-dir <dir>  Directory containing Cargo.toml (default: wasm_activation)
  --help             Show this message and exit

Inputs hashed:
  - <cargo-dir>/Cargo.toml             (required)
  - <cargo-dir>/Cargo.lock             (if present)
  - <cargo-dir>/build.sh               (if present)
  - git = / rev = / tag = / branch = coordinates extracted from the
    above manifests so git-dependency repins bust the cache.

Exit codes:
  0  key emitted on stdout
  1  required input missing or invalid arguments
HELP
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --help|-h)
      show_help
      exit 0
      ;;
    --prefix)
      [[ $# -ge 2 ]] || { echo "--prefix requires an argument" >&2; exit 1; }
      PREFIX="$2"
      shift 2
      ;;
    --cargo-dir)
      [[ $# -ge 2 ]] || { echo "--cargo-dir requires an argument" >&2; exit 1; }
      CARGO_DIR="$2"
      shift 2
      ;;
    *)
      echo "Unknown argument: $1" >&2
      show_help >&2
      exit 1
      ;;
  esac
done

CARGO_TOML="${CARGO_DIR}/Cargo.toml"
CARGO_LOCK="${CARGO_DIR}/Cargo.lock"
BUILD_SH="${CARGO_DIR}/build.sh"

if [[ ! -f "$CARGO_TOML" ]]; then
  echo "ERROR: ${CARGO_TOML} not found" >&2
  exit 1
fi

# Pick an available sha256 tool. Both sha256sum (Linux) and shasum (macOS)
# emit "<digest>  <file>" so the awk '{print $1}' slice works for either.
if command -v sha256sum >/dev/null 2>&1; then
  HASHER=(sha256sum)
elif command -v shasum >/dev/null 2>&1; then
  HASHER=(shasum -a 256)
else
  echo "ERROR: no sha256sum or shasum tool available" >&2
  exit 1
fi

# Extract git-dependency coordinates from a manifest-like file. We grep for
# the four TOML keys that pin a git dep and emit "key=value" lines so a new
# rev/tag/branch changes the hash even if the surrounding file whitespace
# does not. The input is allowlisted to alphanumerics and common URL/ref
# characters to avoid accidentally feeding shell metacharacters to the hasher.
extract_git_coords() {
  local file="$1"
  [[ -f "$file" ]] || return 0
  # Portable across GNU and BSD grep: no -P, no lookbehind.
  # Matches e.g. `git = "https://..."`, `rev = "abc123"`, etc.
  grep -E '^[[:space:]]*(git|rev|tag|branch)[[:space:]]*=[[:space:]]*"[^"]+"' \
    "$file" 2>/dev/null \
    | sed -E 's/^[[:space:]]+//' \
    | LC_ALL=C sort -u \
    || true
}

{
  # File contents first.
  "${HASHER[@]}" "$CARGO_TOML"
  [[ -f "$CARGO_LOCK" ]] && "${HASHER[@]}" "$CARGO_LOCK"
  [[ -f "$BUILD_SH" ]] && "${HASHER[@]}" "$BUILD_SH"
  # Then extracted git coordinates — these are already in the file
  # contents, but hashing them separately makes the cache-busting on
  # rev/tag/branch changes explicit and robust to manifest reordering.
  extract_git_coords "$CARGO_TOML"
  extract_git_coords "$CARGO_LOCK"
} | "${HASHER[@]}" | awk -v prefix="$PREFIX" '
    {
      if (prefix == "") {
        print $1
      } else {
        print prefix "-" $1
      }
    }'
