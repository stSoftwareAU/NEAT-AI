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
ALLOW_UNVERIFIED=false
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
  --allow-unverified
                  Proceed with extraction even when no SHA-256 anchor
                  (deno.json neatCore.assetSha256 or release sidecar
                  wasm_activation-pkg.tar.gz.sha256) attested the tarball.
                  Without this flag an unattested download is a hard error
                  (issue #2744). The downloaded hash is recorded back into
                  deno.json neatCore.assetSha256 so subsequent runs verify.
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
    --allow-unverified)
      ALLOW_UNVERIFIED=true
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
  # shellcheck disable=SC2016 # JS template literals — must not be expanded by bash
  deno eval '
const config = JSON.parse(Deno.readTextFileSync("deno.json"));
const repo = config.neatCore?.repo;
const ref = config.neatCore?.ref ?? "Develop";
const rev = config.neatCore?.rev ?? "";
const assetSha256 = config.neatCore?.assetSha256 ?? "";
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
if (assetSha256 && !/^[0-9a-f]{64}$/.test(String(assetSha256))) {
  console.error("deno.json neatCore.assetSha256 must be 64-char sha-256 when set");
  Deno.exit(5);
}
console.log(`${repo}\n${ref}\n${rev}\n${assetSha256}`);
'
}

cfg_output="$(read_config)"
NEAT_CORE_REPO_DEFAULT="$(printf '%s\n' "$cfg_output" | sed -n '1p')"
NEAT_CORE_REF_DEFAULT="$(printf '%s\n' "$cfg_output" | sed -n '2p')"
NEAT_CORE_REV_DEFAULT="$(printf '%s\n' "$cfg_output" | sed -n '3p')"
NEAT_CORE_ASSET_SHA256_DEFAULT="$(printf '%s\n' "$cfg_output" | sed -n '4p')"

NEAT_CORE_REPO="${NEAT_CORE_REPO:-$NEAT_CORE_REPO_DEFAULT}"
NEAT_CORE_REF="${NEAT_CORE_REF:-$NEAT_CORE_REF_DEFAULT}"
PINNED_REV="$NEAT_CORE_REV_DEFAULT"
PINNED_ASSET_SHA256="$NEAT_CORE_ASSET_SHA256_DEFAULT"

# Tests may override via NEAT_PKG_DIR to avoid concurrent file-system races.
DEST_DIR="${NEAT_PKG_DIR:-wasm_activation/pkg}"
required=(
  "wasm_activation.js"
  "wasm_activation_bg.wasm"
  "wasm_activation.d.ts"
  "wasm_activation_bg.wasm.d.ts"
)
# Files covered by the content manifest. Includes the required set plus
# package.json (also published to JSR and a tampering target).
manifest_files=(
  "wasm_activation.js"
  "wasm_activation_bg.wasm"
  "wasm_activation.d.ts"
  "wasm_activation_bg.wasm.d.ts"
  "package.json"
)
CONTENT_MANIFEST="content-manifest.sha256"

# WASM bundle size sanity threshold — issue #2389 found that the old
# in-repo wasm-pack wrapper produced a ~30 KiB stub with no
# CompiledNetwork bindings; a real bundle is two orders of magnitude
# larger.
MIN_WASM_BYTES=131072

# verify_tarball_sha256 — fail fast on supply-chain tampering of the
# downloaded WASM tarball (issue #2705). Computes shasum -a 256 of the
# file and compares case-insensitively to the expected hash. Source is a
# human-readable origin label (e.g. "deno.json neatCore.assetSha256" or
# "release sidecar wasm_activation-pkg.tar.gz.sha256") used in error
# output so reviewers can tell which guard caught the mismatch.
verify_tarball_sha256() {
  local file="$1"
  local expected="$2"
  local source="$3"
  if ! [[ "$expected" =~ ^[0-9a-fA-F]{64}$ ]]; then
    echo "ERROR: ${source} is not a 64-char SHA-256 (got '${expected}')" >&2
    return 1
  fi
  if ! command -v shasum >/dev/null 2>&1; then
    echo "ERROR: shasum is required to verify ${file} against ${source}" >&2
    return 1
  fi
  local actual
  actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  local expected_lc
  expected_lc="$(printf '%s' "$expected" | tr 'A-F' 'a-f')"
  if [[ "$actual" != "$expected_lc" ]]; then
    echo "ERROR: SHA-256 mismatch for $(basename "$file") (source: ${source})." >&2
    echo "  expected: ${expected_lc}" >&2
    echo "  actual:   ${actual}" >&2
    return 1
  fi
  return 0
}

# guard_unverified_extract — decide whether extraction may proceed when no
# SHA-256 anchor attested the downloaded tarball (issue #2744). A self-
# referential content manifest written from an unattested download proves
# nothing, so an unverified bundle must not be silently extracted.
#   $1 = verified_via   non-empty when a pin or sidecar already matched
#   $2 = allow_unverified  "true" when the operator passed --allow-unverified
# Returns 0 when extraction may proceed, 1 when it must abort.
guard_unverified_extract() {
  local verified_via="$1"
  local allow_unverified="$2"
  if [[ -n "$verified_via" ]]; then
    return 0
  fi
  if [[ "$allow_unverified" == true ]]; then
    return 0
  fi
  return 1
}

# assert_safe_tar_entries — reject path-traversal and absolute-path entries
# before extraction (issue #2744). A malicious tarball entry such as
# `../etc/cron.d/x` or `/etc/passwd` would otherwise be written outside the
# intended wasm_activation/ destination. Lists the archive with `tar -tzf`
# and fails on the first unsafe normalised path.
assert_safe_tar_entries() {
  local archive="$1"
  local entries
  if ! entries="$(tar -tzf "$archive" 2>/dev/null)"; then
    echo "ERROR: could not list contents of $(basename "$archive") for safety check" >&2
    return 1
  fi
  local entry
  while IFS= read -r entry; do
    [[ -z "$entry" ]] && continue
    # Strip a leading ./ so "./../x" is still caught below.
    local normalised="${entry#./}"
    if [[ "$normalised" == /* ]]; then
      echo "ERROR: refusing to extract absolute-path entry from $(basename "$archive"): ${entry}" >&2
      return 1
    fi
    case "/$normalised/" in
      */../*)
        echo "ERROR: refusing to extract path-traversal entry from $(basename "$archive"): ${entry}" >&2
        return 1
        ;;
    esac
  done <<EOF
$entries
EOF
  return 0
}

# write_content_manifest — record sha256(file) for every artefact in the
# vendored pkg so --verify-only can detect post-install tampering even
# without a network round-trip. Format is standard `shasum -a 256`
# output (`<hash>  <filename>`), so verification reuses `shasum -c`.
write_content_manifest() {
  if ! command -v shasum >/dev/null 2>&1; then
    echo "ERROR: shasum is required to write content manifest" >&2
    return 1
  fi
  ( cd "$DEST_DIR" && shasum -a 256 "${manifest_files[@]}" ) \
    > "$DEST_DIR/$CONTENT_MANIFEST"
}

# verify_content_manifest — re-hash every file listed in the manifest
# and fail if any line does not match. Returns non-zero on missing
# manifest, missing tools, or mismatch.
verify_content_manifest() {
  if [[ ! -f "$DEST_DIR/$CONTENT_MANIFEST" ]]; then
    return 1
  fi
  if ! command -v shasum >/dev/null 2>&1; then
    echo "ERROR: shasum is required to verify content manifest" >&2
    return 1
  fi
  # `shasum -c` resolves filenames relative to cwd, so cd into pkg.
  ( cd "$DEST_DIR" && shasum -a 256 -c "$CONTENT_MANIFEST" >/dev/null )
}

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
  # Content-hash gate (issue #2705): every vendored file must match the
  # committed manifest. A missing manifest is treated as a verification
  # failure so the bundle is re-downloaded (or re-hashed) deliberately,
  # never silently trusted.
  if ! verify_content_manifest; then
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
  if [[ ! -f "$DEST_DIR/$CONTENT_MANIFEST" ]]; then
    echo "  - content-manifest.sha256 is missing — bundle integrity cannot be verified." >&2
  else
    echo "  - content-manifest.sha256 verification may have failed (run 'cd $DEST_DIR && shasum -a 256 -c $CONTENT_MANIFEST' to inspect)." >&2
  fi
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

# --- Wait for the per-commit Release to be published --------------------
# Issue #2449: NEAT-AI-core's wasm-bundle.yml workflow takes ~30–60 s to
# publish the `wasm-bundle-<SHA>` Release after a Develop merge. NEAT-AI
# worker PRs raised inside that window otherwise fail immediately. Probe
# the release with bounded retry; only retry on the "release not found"
# / 404 path. Every other error (auth, network, malformed response)
# fails fast.
NEAT_CORE_BUNDLE_RETRIES="${NEAT_CORE_BUNDLE_RETRIES:-5}"
NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS="${NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS:-30}"
if ! [[ "$NEAT_CORE_BUNDLE_RETRIES" =~ ^[0-9]+$ ]] \
  || [[ "$NEAT_CORE_BUNDLE_RETRIES" -lt 1 ]]; then
  echo "ERROR: NEAT_CORE_BUNDLE_RETRIES must be a positive integer (got '${NEAT_CORE_BUNDLE_RETRIES}')." >&2
  exit 1
fi
if ! [[ "$NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS" =~ ^[0-9]+$ ]]; then
  echo "ERROR: NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS must be a non-negative integer (got '${NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS}')." >&2
  exit 1
fi

# Probe whether the release exists. Returns:
#   0 — release published and accessible
#   1 — release does not yet exist (404, retryable)
#   2 — other error (auth, network, malformed) — caller must fail fast
probe_release() {
  local err_file="$tmp_dir/probe.err"
  : > "$err_file"
  if command -v gh >/dev/null 2>&1; then
    if gh api "repos/${NEAT_CORE_REPO}/releases/tags/${RELEASE_TAG}" \
      --silent >/dev/null 2>"$err_file"; then
      return 0
    fi
    if grep -qiE 'HTTP 404|Not Found|release not found' "$err_file"; then
      return 1
    fi
    cat "$err_file" >&2 || true
    return 2
  fi
  # No gh — probe via curl against the GitHub REST API.
  local probe_args=(-sS -o /dev/null -w '%{http_code}')
  if [[ -n "${NEAT_CORE_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
    probe_args+=(-H "Authorization: Bearer ${NEAT_CORE_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}")
  fi
  local probe_url="https://api.github.com/repos/${NEAT_CORE_REPO}/releases/tags/${RELEASE_TAG}"
  local status_code
  status_code="$(curl "${probe_args[@]}" "$probe_url" 2>"$err_file" || echo 000)"
  case "$status_code" in
    200) return 0 ;;
    404) return 1 ;;
    *)
      cat "$err_file" >&2 || true
      echo "ERROR: HTTP ${status_code} probing ${probe_url}" >&2
      return 2
      ;;
  esac
}

attempt=1
while : ; do
  set +e
  probe_release
  probe_rc=$?
  set -e
  case "$probe_rc" in
    0) break ;;
    1)
      if [[ "$attempt" -ge "$NEAT_CORE_BUNDLE_RETRIES" ]]; then
        total_wait=$((NEAT_CORE_BUNDLE_RETRIES * NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS))
        echo "ERROR: Release ${RELEASE_TAG} did not appear after ${NEAT_CORE_BUNDLE_RETRIES} attempts (~${total_wait}s)." >&2
        echo "  - Failure mode: the release never appeared (distinct from a missing asset on a published release)." >&2
        echo "  - The NEAT-AI-core wasm-bundle.yml workflow may still be running, have failed, or never been triggered for ${TARGET_REV}." >&2
        echo "  - Workflow runs: https://github.com/${NEAT_CORE_REPO}/actions/workflows/wasm-bundle.yml" >&2
        echo "  - Tag URL:       https://github.com/${NEAT_CORE_REPO}/releases/tag/${RELEASE_TAG}" >&2
        echo "  - Tune retries via NEAT_CORE_BUNDLE_RETRIES / NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS." >&2
        exit 1
      fi
      echo "Release ${RELEASE_TAG} not yet published (attempt ${attempt}/${NEAT_CORE_BUNDLE_RETRIES}); retrying in ${NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS}s..." >&2
      sleep "$NEAT_CORE_BUNDLE_RETRY_DELAY_SECONDS"
      attempt=$((attempt + 1))
      ;;
    *)
      echo "ERROR: Probe for release ${RELEASE_TAG} failed with a non-404 error (auth, network, or malformed response)." >&2
      echo "  - This is a fail-fast condition; retries only fire on the 'release not found' path." >&2
      echo "  - For private repos, set NEAT_CORE_GITHUB_TOKEN or GITHUB_TOKEN with read access." >&2
      exit 1
      ;;
  esac
done

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
    echo "  - Failure mode: the release exists but the asset is missing or unreadable." >&2
    echo "  - The release-not-found propagation race is handled separately by NEAT_CORE_BUNDLE_RETRIES (default 5) — that retry already succeeded." >&2
    echo "  - Confirm the asset is attached: https://github.com/${NEAT_CORE_REPO}/releases/tag/${RELEASE_TAG}" >&2
    echo "  - For private repos, set NEAT_CORE_GITHUB_TOKEN or GITHUB_TOKEN with read access." >&2
    exit 1
  fi
fi

# --- Verify tarball content hash before extract (issue #2705) -----------
# Two independent guards run against the downloaded tarball:
#   1. The optional pin in deno.json neatCore.assetSha256, which lets a
#      reviewer spot bundle-content changes in a single line of diff.
#   2. The optional release-side sidecar wasm_activation-pkg.tar.gz.sha256
#      published by NEAT-AI-core CI alongside the tarball.
# Either present guard MUST match before extraction. If both are absent
# the run still proceeds (the upstream workflow may not yet publish a
# sidecar and the pin is empty on fresh setups), but a clear advisory is
# printed so reviewers do not silently ship an unverified bundle.
SIDECAR_NAME="${ASSET_NAME}.sha256"
sidecar_path="$tmp_dir/$SIDECAR_NAME"
sidecar_ok=false
if command -v gh >/dev/null 2>&1; then
  if gh release download "$RELEASE_TAG" \
    --repo "$NEAT_CORE_REPO" \
    --pattern "$SIDECAR_NAME" \
    --dir "$tmp_dir" 2>/dev/null; then
    sidecar_ok=true
  fi
fi
if [[ "$sidecar_ok" != true ]]; then
  sidecar_args=(-fsSL)
  if [[ -n "${NEAT_CORE_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}" ]]; then
    sidecar_token="${NEAT_CORE_GITHUB_TOKEN:-${GITHUB_TOKEN:-}}"
    sidecar_args+=(-H "Authorization: Bearer ${sidecar_token}")
  fi
  sidecar_url="https://github.com/${NEAT_CORE_REPO}/releases/download/${RELEASE_TAG}/${SIDECAR_NAME}"
  if curl "${sidecar_args[@]}" -o "$sidecar_path" "$sidecar_url" 2>/dev/null; then
    sidecar_ok=true
  fi
fi

verified_via=""
if [[ "$sidecar_ok" == true && -s "$sidecar_path" ]]; then
  # Standard `shasum -a 256` output is `<hash>  <filename>`. We only
  # consume the leading 64 hex chars to be lenient about whitespace.
  expected_sidecar="$(awk '{print $1}' <"$sidecar_path" | head -n1)"
  if ! verify_tarball_sha256 \
    "$tmp_dir/$ASSET_NAME" \
    "$expected_sidecar" \
    "release sidecar ${SIDECAR_NAME}"; then
    exit 1
  fi
  verified_via="sidecar ${SIDECAR_NAME}"
fi

if [[ -n "$PINNED_ASSET_SHA256" ]]; then
  if ! verify_tarball_sha256 \
    "$tmp_dir/$ASSET_NAME" \
    "$PINNED_ASSET_SHA256" \
    "deno.json neatCore.assetSha256"; then
    exit 1
  fi
  if [[ -n "$verified_via" ]]; then
    verified_via="${verified_via} and deno.json neatCore.assetSha256"
  else
    verified_via="deno.json neatCore.assetSha256"
  fi
fi

if [[ -n "$verified_via" ]]; then
  echo "Tarball SHA-256 verified via ${verified_via}."
elif ! guard_unverified_extract "$verified_via" "$ALLOW_UNVERIFIED"; then
  echo "ERROR: no SHA-256 source for ${ASSET_NAME} (neither deno.json neatCore.assetSha256 nor release sidecar ${SIDECAR_NAME} present)." >&2
  echo "       Refusing to extract an unattested tarball — the content manifest written from an" >&2
  echo "       unverified download is self-referential and proves nothing about provenance (issue #2744)." >&2
  echo "       Fix one of:" >&2
  echo "         - set neatCore.assetSha256 in deno.json to the expected 64-char SHA-256, or" >&2
  echo "         - have NEAT-AI-core publish the ${SIDECAR_NAME} release sidecar, or" >&2
  echo "         - re-run with --allow-unverified to bootstrap the pin (the downloaded hash is" >&2
  echo "           then recorded into deno.json neatCore.assetSha256 for future verification)." >&2
  exit 1
else
  echo "WARNING: no SHA-256 source for ${ASSET_NAME} (neither deno.json neatCore.assetSha256 nor release sidecar ${SIDECAR_NAME} present)." >&2
  echo "         Proceeding because --allow-unverified was passed; the downloaded hash will be" >&2
  echo "         recorded into deno.json neatCore.assetSha256 so subsequent runs are attested." >&2
fi

# Record the tarball's own hash for transparency and for pinning back into
# deno.json neatCore.assetSha256 below. The per-file manifest (written
# after extract) is what `--verify-only` actually checks.
DOWNLOADED_ASSET_SHA256="$(shasum -a 256 "$tmp_dir/$ASSET_NAME" | awk '{print $1}')"
echo "Downloaded tarball SHA-256: ${DOWNLOADED_ASSET_SHA256}"

# Reject path-traversal / absolute-path entries before touching the tree
# (issue #2744), then extract without honouring archived ownership or
# permission bits.
assert_safe_tar_entries "$tmp_dir/$ASSET_NAME"

mkdir -p "wasm_activation"
echo "Extracting ${ASSET_NAME} into wasm_activation/..."
tar --no-same-owner --no-same-permissions -xzf "$tmp_dir/$ASSET_NAME" -C "wasm_activation/"

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

# --- Update deno.json neatCore.rev + assetSha256 ------------------------
# Record the downloaded tarball hash as the committed pin so future runs
# verify against it (issue #2744). Values are passed via the environment,
# never interpolated into the eval source, so a hostile rev/hash cannot
# inject code (both are already validated as hex above).
if [[ "$PINNED_REV" != "$TARGET_REV" ]] \
  || [[ "$PINNED_ASSET_SHA256" != "$DOWNLOADED_ASSET_SHA256" ]]; then
  echo "Updating deno.json neatCore.rev: ${PINNED_REV:-<unset>} -> ${TARGET_REV}"
  echo "Updating deno.json neatCore.assetSha256: ${PINNED_ASSET_SHA256:-<unset>} -> ${DOWNLOADED_ASSET_SHA256}"
  NEAT_TARGET_REV="$TARGET_REV" \
  NEAT_ASSET_SHA256="$DOWNLOADED_ASSET_SHA256" \
  deno eval '
const path = "deno.json";
const config = JSON.parse(Deno.readTextFileSync(path));
config.neatCore = config.neatCore ?? {};
config.neatCore.rev = Deno.env.get("NEAT_TARGET_REV");
config.neatCore.assetSha256 = Deno.env.get("NEAT_ASSET_SHA256");
Deno.writeTextFileSync(path, JSON.stringify(config, null, 2) + "\n");
'
fi

refresh_fingerprint "$TARGET_REV"

# --- Record per-file content manifest (issue #2705) ---------------------
# Written after every successful download so --verify-only can detect
# any later tampering with vendored pkg files without re-fetching the
# tarball. Commit content-manifest.sha256 with the rest of pkg/**.
echo "Writing $DEST_DIR/$CONTENT_MANIFEST..."
write_content_manifest

echo ""
echo "✅ wasm_activation/pkg refreshed to ${NEAT_CORE_REPO}@${TARGET_REV}"
echo "   Commit deno.json AND wasm_activation/pkg/** together to advance the pin."
