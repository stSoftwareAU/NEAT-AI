#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

CLEAN=false

show_help() {
  cat <<'HELP'
Usage: ./build.sh [OPTIONS]

Verify wasm_activation/pkg matches deno.json neatCore.rev (vendored artifacts).

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
  wasm_bytes="$(wc -c <"$DEST_DIR/wasm_activation_bg.wasm" | tr -d ' ')"
  # The previous wasm-pack wrapper path produced a ~30KiB stub with no
  # CompiledNetwork bindings; a real pkg is two orders of magnitude larger.
  if [[ "${wasm_bytes:-0}" -lt 131072 ]]; then
    echo "ERROR: $DEST_DIR/wasm_activation_bg.wasm is too small (${wasm_bytes} bytes)." >&2
    echo "This usually means a stub WASM replaced the vendored activation package." >&2
    echo "Restore from git, e.g.: git checkout Develop -- $DEST_DIR/" >&2
    exit 1
  fi
  if command -v shasum >/dev/null 2>&1; then
    fingerprint_input="${NEAT_CORE_REPO}@${NEAT_CORE_REV}"
    printf '%s' "$fingerprint_input" | shasum -a 256 | awk '{print $1}' \
      > "$DEST_DIR/build-fingerprint"
  fi
  echo "Skipping build: $DEST_DIR already matches ${NEAT_CORE_REPO}@${NEAT_CORE_REV}"
  exit 0
fi

echo "ERROR: wasm_activation/pkg is missing or does not match pinned NEAT-AI-core revision." >&2
echo "  Expected ${NEAT_CORE_REPO}@${NEAT_CORE_REV} (see deno.json neatCore.rev and $DEST_DIR/neat_core_rev.txt)." >&2
echo "Automated rebuild was removed: the wasm-pack wrapper produced a non-functional stub." >&2
echo "Restore the in-repo WASM package from git (same rev as neatCore.rev), then re-run ./build.sh." >&2
exit 1
