#!/usr/bin/env bash
# Verify that a just-published JSR release carries Sigstore provenance.
#
# Issue #3334 (parent #3332): the publish pipeline silently succeeded while
# producing NO provenance attestation for v5.8.1 (rekorLogId null on JSR). A
# release that publishes without provenance must fail LOUDLY (non-zero exit),
# not pass quietly. This script is the guardrail: it polls the JSR version
# meta endpoint and fails the job when rekorLogId is null/absent.
#
# Usage:
#   scripts/verify_jsr_provenance.sh                 # read name/version from deno.json
#   scripts/verify_jsr_provenance.sh --name @scope/pkg --version 1.2.3
#   scripts/verify_jsr_provenance.sh --meta-file fixture.json   # local meta (tests)
#   scripts/verify_jsr_provenance.sh --help
#
# JSR is eventually consistent, so the check retries a bounded number of times
# before giving up. Tuning knobs (used by tests to stay fast):
#   VERIFY_JSR_MAX_ATTEMPTS   attempts before failing (default 5)
#   VERIFY_JSR_RETRY_DELAY    seconds between attempts (default 6)
#
# Exit codes:
#   0  provenance recorded (non-null rekorLogId)
#   1  no provenance after all attempts, or a usage/lookup error

set -Eeuo pipefail

MAX_ATTEMPTS="${VERIFY_JSR_MAX_ATTEMPTS:-5}"
RETRY_DELAY="${VERIFY_JSR_RETRY_DELAY:-6}"

NAME=""
VERSION=""
META_FILE=""

show_help() {
  cat <<'HELP'
Usage: scripts/verify_jsr_provenance.sh [OPTIONS]

Fail loudly when a published JSR version has no Sigstore provenance
(rekorLogId is null/absent). Reuses the name/version extraction pattern
from .github/workflows/publish.yml.

Options:
  --name NAME         Package name (default: jq -r .name deno.json)
  --version VERSION   Package version (default: jq -r .version deno.json)
  --meta-file FILE    Read meta JSON from a local file instead of JSR
                      (bypasses the network; used by tests)
  --help              Show this help and exit

Environment:
  VERIFY_JSR_MAX_ATTEMPTS   Retry attempts before failing (default 5)
  VERIFY_JSR_RETRY_DELAY    Seconds between attempts (default 6)

Exit codes:
  0  provenance recorded (non-null rekorLogId)
  1  no provenance after all attempts, or a usage/lookup error
HELP
}

while [ "$#" -gt 0 ]; do
  case "$1" in
    --name)
      NAME="${2:-}"
      shift 2
      ;;
    --version)
      VERSION="${2:-}"
      shift 2
      ;;
    --meta-file)
      META_FILE="${2:-}"
      shift 2
      ;;
    --help | -h)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run 'scripts/verify_jsr_provenance.sh --help' for usage." >&2
      exit 1
      ;;
  esac
done

# Fall back to deno.json for anything not supplied explicitly. Mirror the
# `jq -r .name/.version deno.json` pattern already used in publish.yml.
if [ -z "$NAME" ]; then
  NAME=$(jq -r .name deno.json)
fi
if [ -z "$VERSION" ]; then
  VERSION=$(jq -r .version deno.json)
fi

if [ -z "$NAME" ] || [ "$NAME" = "null" ] || [ -z "$VERSION" ] || [ "$VERSION" = "null" ]; then
  echo "❌ Could not determine package name/version for provenance check." >&2
  exit 1
fi

META_URL="https://jsr.io/${NAME}/${VERSION}_meta.json"

# Fetch the meta document into $1. Returns non-zero when the document could
# not be retrieved so the caller can retry. Never masks a fetch failure as a
# valid (empty) document.
fetch_meta() {
  local out="$1"
  if [ -n "$META_FILE" ]; then
    [ -f "$META_FILE" ] || return 1
    cat "$META_FILE" >"$out"
    return 0
  fi
  curl -sf "$META_URL" -o "$out"
}

echo "🔎 Verifying JSR provenance for ${NAME}@${VERSION}"
[ -n "$META_FILE" ] && echo "   (meta source: ${META_FILE})"

tmp_meta="$(mktemp)"
trap 'rm -f "$tmp_meta"' EXIT

attempt=1
while [ "$attempt" -le "$MAX_ATTEMPTS" ]; do
  if fetch_meta "$tmp_meta"; then
    # rekorLogId is the Sigstore transparency-log entry recorded when JSR
    # attests provenance. Absent/null means no attestation was produced.
    rekor=$(jq -r '.rekorLogId // "null"' "$tmp_meta" 2>/dev/null || echo "null")
    if [ -n "$rekor" ] && [ "$rekor" != "null" ]; then
      echo "✅ Provenance recorded for ${NAME}@${VERSION} (rekorLogId=${rekor})."
      exit 0
    fi
    echo "… attempt ${attempt}/${MAX_ATTEMPTS}: rekorLogId still null/absent for ${NAME}@${VERSION}." >&2
  else
    echo "… attempt ${attempt}/${MAX_ATTEMPTS}: could not fetch ${META_URL} (JSR eventual consistency?)." >&2
  fi

  if [ "$attempt" -lt "$MAX_ATTEMPTS" ]; then
    sleep "$RETRY_DELAY"
  fi
  attempt=$((attempt + 1))
done

echo "❌ No Sigstore provenance for ${NAME}@${VERSION}: rekorLogId is null/absent" >&2
echo "   after ${MAX_ATTEMPTS} attempt(s) against ${META_URL}." >&2
echo "   A release must publish WITH provenance (Issue #3334). Failing the job." >&2
exit 1
