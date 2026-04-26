#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# build.sh — refresh wasm_activation/pkg from upstream NEAT-AI-core.
#
# Issue #2433 / #2434: NEAT-AI is pure TypeScript. The WASM bundle is
# produced by NEAT-AI-core CI and published per-commit on the Develop
# branch as a GitHub Release tagged `wasm-bundle-<SHA>` carrying the
# asset `wasm_activation-pkg.tar.gz`. This script either advances the
# vendored bundle to the upstream Develop HEAD (default) or verifies
# the existing bundle matches the pin in deno.json (--verify-only).

CLEAN=false
VERIFY_ONLY=false
EXPLICIT_REV=""

show_help() {
  cat <<'HELP'
Usage: ./build.sh [OPTIONS]

Sync wasm_activation/pkg with NEAT-AI-core.

Default behaviour (no flags):
  1. Resolve NEAT-AI-core Develop HEAD via the GitHub API.
  2. If HEAD == deno.json neatCore.rev and the vendored pkg matches,
     do nothing.
  3. Otherwise download wasm_activation-pkg.tar.gz from the matching
     `wasm-bundle-<SHA>` Release, unpack it into wasm_activation/, and
     update deno.json neatCore.rev to <SHA>.

Options:
  --rev <SHA>     Pin to a specific 40-char NEAT-AI-core revision instead
                  of resolving Develop HEAD. Useful for reproducing an
                  old build.
  --verify-only   Do not contact the network or modify deno.json. Just
                  verify wasm_activation/pkg matches deno.json neatCore.rev.
                  Used by quality.sh and CI.
  --clean         Delete wasm_activation/pkg before download.
  --help, -h      Show this help and exit.
HELP
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --clean)
      CLEAN=true
      shift
      ;;
    --verify-only)
      VERIFY_ONLY=true
      shift
      ;;
    --rev)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --rev requires a 40-character hex SHA argument" >&2
        exit 1
      fi
      EXPLICIT_REV="$2"
      if ! [[ "$EXPLICIT_REV" =~ ^[0-9a-f]{40}$ ]]; then
        echo "ERROR: --rev must be a 40-character lowercase hex SHA, got '$EXPLICIT_REV'" >&2
        exit 1
      fi
      shift 2
      ;;
    --rev=*)
      EXPLICIT_REV="${1#--rev=}"
      if ! [[ "$EXPLICIT_REV" =~ ^[0-9a-f]{40}$ ]]; then
        echo "ERROR: --rev must be a 40-character lowercase hex SHA, got '$EXPLICIT_REV'" >&2
        exit 1
      fi
      shift
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
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
PINNED_REV="$NEAT_CORE_REV_DEFAULT"

DEST_DIR="wasm_activation/pkg"
required=(
  "wasm_activation.js"
  "wasm_activation_bg.wasm"
  "wasm_activation.d.ts"
  "wasm_activation_bg.wasm.d.ts"
)

# WASM bundle size sanity threshold — issue #2389 found that the old
# in-repo wasm-pack wrapper produced a ~30 KiB stub with no
# CompiledNetwork bindings; a real bundle is two orders of magnitude
# larger.
MIN_WASM_BYTES=131072

verify_pkg_matches() {
  local expected_rev="$1"
  if [[ ! -f "$DEST_DIR/neat_core_rev.txt" ]]; then
    return 1
  fi
  local current_rev
  current_rev="$(tr -d '\n\r' < "$DEST_DIR/neat_core_rev.txt")"
  if [[ "$current_rev" != "$expected_rev" ]]; then
    return 1
  fi
  for file in "${required[@]}"; do
    if [[ ! -f "$DEST_DIR/$file" ]]; then
      return 1
    fi
  done
  local wasm_bytes
  wasm_bytes="$(wc -c <"$DEST_DIR/wasm_activation_bg.wasm" | tr -d ' ')"
  if [[ "${wasm_bytes:-0}" -lt $MIN_WASM_BYTES ]]; then
    return 1
  fi
  return 0
}

refresh_fingerprint() {
  local rev="$1"
  if command -v shasum >/dev/null 2>&1; then
    local fingerprint_input="${NEAT_CORE_REPO}@${rev}"
    printf '%s' "$fingerprint_input" | shasum -a 256 | awk '{print $1}' \
      > "$DEST_DIR/build-fingerprint"
  fi
}

# --- Verify-only path ----------------------------------------------------
# No network. No deno.json mutation. Just check the vendored bundle
# matches the pinned rev. Used by quality.sh and CI.
if [[ "$VERIFY_ONLY" == true ]]; then
  if [[ -z "$PINNED_REV" ]]; then
    echo "ERROR: --verify-only requires deno.json neatCore.rev to be set" >&2
    exit 1
  fi
  if verify_pkg_matches "$PINNED_REV"; then
    # Verify-only is a read-only check; do not refresh the fingerprint
    # (the fingerprint reflects the last successful download, not a
    # verification, and may legitimately be missing on fresh clones).
    echo "Skipping build: $DEST_DIR already matches ${NEAT_CORE_REPO_DEFAULT}@${PINNED_REV}"
    exit 0
  fi
  echo "ERROR: $DEST_DIR does not match deno.json neatCore.rev (${PINNED_REV})." >&2
  echo "Run './build.sh' (without --verify-only) to refresh the bundle from upstream." >&2
  exit 1
fi

# --- Resolve target rev --------------------------------------------------
TARGET_REV=""
if [[ -n "$EXPLICIT_REV" ]]; then
  TARGET_REV="$EXPLICIT_REV"
elif [[ -n "${NEAT_CORE_REV:-}" ]]; then
  if ! [[ "$NEAT_CORE_REV" =~ ^[0-9a-f]{40}$ ]]; then
    echo "ERROR: NEAT_CORE_REV env override must be a 40-char hex SHA" >&2
    exit 1
  fi
  TARGET_REV="$NEAT_CORE_REV"
else
  if ! command -v gh >/dev/null 2>&1; then
    echo "ERROR: gh (GitHub CLI) is required to resolve Develop HEAD." >&2
    echo "Install gh, set NEAT_CORE_REV explicitly, or pass --rev <SHA>." >&2
    exit 1
  fi
  echo "Resolving ${NEAT_CORE_REPO}@${NEAT_CORE_REF} HEAD..."
  resolved_rev="$(gh api "repos/${NEAT_CORE_REPO}/commits/${NEAT_CORE_REF}" --jq .sha 2>/dev/null || true)"
  if ! [[ "$resolved_rev" =~ ^[0-9a-f]{40}$ ]]; then
    echo "ERROR: Could not resolve commit SHA for ${NEAT_CORE_REPO}@${NEAT_CORE_REF}" >&2
    echo "Ensure 'gh auth status' is authenticated, or pass --rev <SHA>." >&2
    exit 1
  fi
  TARGET_REV="$resolved_rev"
fi

echo "Target NEAT-AI-core revision: ${TARGET_REV}"

# --- No-op fast path: pin matches and pkg is intact ---------------------
if [[ "$CLEAN" != true ]] && [[ "$PINNED_REV" == "$TARGET_REV" ]] \
  && verify_pkg_matches "$TARGET_REV"; then
  # No download performed, so leave build-fingerprint as last build wrote it.
  echo "Skipping build: $DEST_DIR already matches ${NEAT_CORE_REPO}@${TARGET_REV}"
  exit 0
fi

# --- Download artifact --------------------------------------------------
if [[ "$CLEAN" == true ]]; then
  echo "Cleaning $DEST_DIR before download..."
  rm -rf "$DEST_DIR"
fi

ASSET_NAME="wasm_activation-pkg.tar.gz"
RELEASE_TAG="wasm-bundle-${TARGET_REV}"

tmp_dir="$(mktemp -d)"
trap 'rm -rf "$tmp_dir"' EXIT

echo "Downloading ${ASSET_NAME} from ${NEAT_CORE_REPO} release ${RELEASE_TAG}..."
download_ok=false
if command -v gh >/dev/null 2>&1; then
  if gh release download "$RELEASE_TAG" \
    --repo "$NEAT_CORE_REPO" \
    --pattern "$ASSET_NAME" \
    --dir "$tmp_dir" 2>"$tmp_dir/gh.err"; then
    download_ok=true
  else
    cat "$tmp_dir/gh.err" >&2 || true
  fi
fi

if [[ "$download_ok" != true ]]; then
  # Fall back to direct release-asset download via curl. Allows running
  # without gh on CI runners that only have curl.
  curl_args=(-fsSL)
  if [[ -n "${NEAT_CORE_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
    token="${NEAT_CORE_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
    curl_args+=(-H "Authorization: Bearer ${token}")
  fi
  asset_url="https://github.com/${NEAT_CORE_REPO}/releases/download/${RELEASE_TAG}/${ASSET_NAME}"
  if ! curl "${curl_args[@]}" -o "$tmp_dir/$ASSET_NAME" "$asset_url"; then
    echo "ERROR: Could not download ${ASSET_NAME} from ${NEAT_CORE_REPO} release ${RELEASE_TAG}." >&2
    echo "  - Confirm the release exists: https://github.com/${NEAT_CORE_REPO}/releases/tag/${RELEASE_TAG}" >&2
    echo "  - The per-commit Release is published by NEAT-AI-core CI; for very recent commits it may not be available yet." >&2
    echo "  - For private repos, set NEAT_CORE_GITHUB_TOKEN or GITHUB_TOKEN with read access." >&2
    exit 1
  fi
fi

mkdir -p "wasm_activation"
echo "Extracting ${ASSET_NAME} into wasm_activation/..."
tar -xzf "$tmp_dir/$ASSET_NAME" -C "wasm_activation/"

# Ensure neat_core_rev.txt is consistent with the requested SHA. CI
# writes this file, but we re-stamp it defensively in case someone
# repackages the bundle without it.
echo "$TARGET_REV" > "$DEST_DIR/neat_core_rev.txt"

# --- Verify the freshly-extracted bundle --------------------------------
for file in "${required[@]}"; do
  if [[ ! -f "$DEST_DIR/$file" ]]; then
    echo "ERROR: expected $DEST_DIR/$file in extracted bundle" >&2
    exit 1
  fi
done

wasm_bytes="$(wc -c <"$DEST_DIR/wasm_activation_bg.wasm" | tr -d ' ')"
if [[ "${wasm_bytes:-0}" -lt $MIN_WASM_BYTES ]]; then
  echo "ERROR: $DEST_DIR/wasm_activation_bg.wasm is too small (${wasm_bytes} bytes)." >&2
  echo "This usually means the bundle is a stub and not a real CompiledNetwork build." >&2
  exit 1
fi

# --- Update deno.json neatCore.rev --------------------------------------
if [[ "$PINNED_REV" != "$TARGET_REV" ]]; then
  echo "Updating deno.json neatCore.rev: ${PINNED_REV:-<unset>} -> ${TARGET_REV}"
  deno eval "
const path = 'deno.json';
const config = JSON.parse(Deno.readTextFileSync(path));
config.neatCore = config.neatCore ?? {};
config.neatCore.rev = '${TARGET_REV}';
Deno.writeTextFileSync(path, JSON.stringify(config, null, 2) + '\n');
"
fi

refresh_fingerprint "$TARGET_REV"

echo ""
echo "✅ wasm_activation/pkg refreshed to ${NEAT_CORE_REPO}@${TARGET_REV}"
echo "   Commit deno.json AND wasm_activation/pkg/** together to advance the pin."
