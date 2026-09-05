#!/usr/bin/env bash
#
# Licence-less gitleaks scan (Issue #3950).
#
# `gitleaks/gitleaks-action` needs an organisation licence on org-owned
# repositories. Dependabot-authored pull requests receive no Actions secrets,
# so the licence arrives empty and the action exits with `ErrLicense` before
# scanning anything — the job goes green over an unscanned diff, which is
# worse than no gate at all because it reads as covered.
#
# `.github/workflows/quality.yml` runs this script instead whenever the
# licence is absent. It fetches the free, open-source CLI at a pinned version,
# verifies it against its published SHA-256 checksum, and scans.
#
# Usage: scripts/gitleaks-scan.sh [target-directory]
#
# Environment:
#   BASE_SHA, HEAD_SHA  Commit range to scan. When either is empty or not
#                       reachable in the checkout, the whole working tree is
#                       scanned instead — never nothing.
#   GITLEAKS_BIN        Path to an already-installed gitleaks; skips the
#                       download entirely.
#   GITLEAKS_VERSION    Release to download (without the leading `v`).
#   GITLEAKS_ASSET      Release asset name; defaults to the build matching
#                       this host.
#   GITLEAKS_SHA256     Expected SHA-256 of that asset.
#   GITLEAKS_BASE_URL   Release download location.

set -euo pipefail

# To bump: pick a release from https://github.com/gitleaks/gitleaks/releases
# and copy the matching lines out of that release's `*_checksums.txt`.
GITLEAKS_VERSION="${GITLEAKS_VERSION:-8.30.1}"
GITLEAKS_SHA256_LINUX_X64="551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb"
GITLEAKS_SHA256_LINUX_ARM64="e4a487ee7ccd7d3a7f7ec08657610aa3606637dab924210b3aee62570fb4b080"
GITLEAKS_BASE_URL="${GITLEAKS_BASE_URL:-https://github.com/gitleaks/gitleaks/releases/download}"

TARGET_DIR="${1:-.}"
BASE_SHA="${BASE_SHA:-}"
HEAD_SHA="${HEAD_SHA:-}"

die() {
  echo "❌ gitleaks-scan: $*" >&2
  exit 1
}

# Resolve the release asset and its pinned checksum for this host. Both are
# overridable so a caller can pin a different build; an unknown host is a loud
# failure rather than an unverified download.
resolve_asset() {
  local host
  host="$(uname -s)/$(uname -m)"
  case "$host" in
    Linux/x86_64)
      GITLEAKS_ASSET="${GITLEAKS_ASSET:-gitleaks_${GITLEAKS_VERSION}_linux_x64.tar.gz}"
      GITLEAKS_SHA256="${GITLEAKS_SHA256:-$GITLEAKS_SHA256_LINUX_X64}"
      ;;
    Linux/aarch64 | Linux/arm64)
      GITLEAKS_ASSET="${GITLEAKS_ASSET:-gitleaks_${GITLEAKS_VERSION}_linux_arm64.tar.gz}"
      GITLEAKS_SHA256="${GITLEAKS_SHA256:-$GITLEAKS_SHA256_LINUX_ARM64}"
      ;;
    *)
      if [[ -z "${GITLEAKS_ASSET:-}" || -z "${GITLEAKS_SHA256:-}" ]]; then
        die "no pinned build for ${host}; set GITLEAKS_BIN, or GITLEAKS_ASSET and GITLEAKS_SHA256"
      fi
      ;;
  esac
}

# Download the pinned CLI into a scratch directory and verify it before it is
# ever executed. The scratch directory sits outside the workspace so the
# binary cannot be picked up by the repository's own file checks or staged by
# a later step.
install_gitleaks() {
  local dir
  resolve_asset
  dir="$(mktemp -d)"

  curl --fail --silent --show-error --location --retry 3 \
    --output "${dir}/${GITLEAKS_ASSET}" \
    "${GITLEAKS_BASE_URL}/v${GITLEAKS_VERSION}/${GITLEAKS_ASSET}" ||
    die "could not download ${GITLEAKS_ASSET}"

  if ! (
    cd "$dir" &&
      printf '%s  %s\n' "$GITLEAKS_SHA256" "$GITLEAKS_ASSET" | sha256sum -c -
  ) >/dev/null 2>&1; then
    die "checksum mismatch for ${GITLEAKS_ASSET} — refusing to run it"
  fi

  tar -xzf "${dir}/${GITLEAKS_ASSET}" -C "$dir" gitleaks ||
    die "could not extract gitleaks from ${GITLEAKS_ASSET}"

  printf '%s' "${dir}/gitleaks"
}

# True when both endpoints of the pull-request range exist in this checkout.
# `gitleaks git --log-opts` exits 0 on a range git cannot resolve, so an
# unverified range would scan nothing and still report success.
range_is_scannable() {
  [[ -n "$BASE_SHA" && -n "$HEAD_SHA" ]] &&
    git -C "$TARGET_DIR" cat-file -e "${BASE_SHA}^{commit}" 2>/dev/null &&
    git -C "$TARGET_DIR" cat-file -e "${HEAD_SHA}^{commit}" 2>/dev/null
}

main() {
  local bin
  if [[ -n "${GITLEAKS_BIN:-}" ]]; then
    bin="$GITLEAKS_BIN"
    [[ -x "$bin" ]] || die "GITLEAKS_BIN=${bin} is not executable"
  else
    bin="$(install_gitleaks)"
  fi

  if range_is_scannable; then
    echo "🔍 gitleaks: scanning ${BASE_SHA}..${HEAD_SHA}"
    "$bin" git --redact --no-banner --exit-code 1 \
      --log-opts="${BASE_SHA}..${HEAD_SHA}" "$TARGET_DIR"
  else
    echo "🔍 gitleaks: no reachable commit range — scanning the whole working tree"
    "$bin" dir --redact --no-banner --exit-code 1 "$TARGET_DIR"
  fi
}

main "$@"
