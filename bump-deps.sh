#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

# bump-deps.sh — pre-PR dependency refresh, invoked by the Vibe Coder
# worker before quality.sh (see VibeCoding#1613, #1614).
#
# Internal (NEAT-AI-core, stSoftwareAU/*):
#   Advances deno.json neatCore.rev to NEAT-AI-core Develop HEAD by
#   re-running ./build.sh, which downloads the matching wasm bundle
#   and updates the pin atomically. No quarantine — internal deps
#   bump immediately.
#
# External (jsr:@std/*, npm:*, https://deno.land/*):
#   Bumps Deno imports in deno.json to the latest version published
#   more than VIBE_BUMP_QUARANTINE_HOURS hours ago (default 24h).
#   The quarantine dodges fast-flagged supply-chain attacks. Runs via
#   `deno outdated --update --latest --minimum-dependency-age=<min>`.
#
# Audit gate:
#   After bumping, runs `deno check` — any new type error attributable
#   to the bump fails the script with a non-zero exit code. The worker
#   then reverts per the VibeCoding#1613 contract.
#
# Output:
#   Prints a one-line summary of what was bumped (or "no bumps" when
#   already current).

QUARANTINE_HOURS="${VIBE_BUMP_QUARANTINE_HOURS:-24}"
SKIP_INTERNAL=false
SKIP_EXTERNAL=false
DRY_RUN=false

show_help() {
  cat <<'HELP'
Usage: ./bump-deps.sh [OPTIONS]

Refresh NEAT-AI-core (internal) and Deno (external) dependencies for
the Vibe Coder pre-PR worker hook, then run `deno check` as the audit
gate.

Internal bump: advances deno.json neatCore.rev to NEAT-AI-core Develop
HEAD by invoking ./build.sh. No quarantine for stSoftwareAU/* deps.

External bump: runs `deno outdated --update --latest` with
`--minimum-dependency-age` set from VIBE_BUMP_QUARANTINE_HOURS
(default 24h) to skip too-recent registry versions.

Options:
  --no-internal             Skip the NEAT-AI-core neatCore.rev bump.
  --no-external             Skip the external Deno dep bump.
  --quarantine-hours <H>    Override VIBE_BUMP_QUARANTINE_HOURS.
                            Must be a non-negative integer (default 24).
  --dry-run                 Print what would be bumped without writing
                            anything. Does not contact the network and
                            does not mutate deno.json.
  --help, -h                Show this help and exit.

Exit codes:
  0   No-op or successful bump; `deno check` is green.
  1   Bump attempted but rejected (audit gate failed, invalid flag,
      or upstream lookup failed). The worker should revert.
HELP
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --no-internal)
      SKIP_INTERNAL=true
      shift
      ;;
    --no-external)
      SKIP_EXTERNAL=true
      shift
      ;;
    --quarantine-hours)
      if [[ $# -lt 2 ]]; then
        echo "ERROR: --quarantine-hours requires a non-negative integer" >&2
        exit 1
      fi
      QUARANTINE_HOURS="$2"
      shift 2
      ;;
    --quarantine-hours=*)
      QUARANTINE_HOURS="${1#--quarantine-hours=}"
      shift
      ;;
    --dry-run)
      DRY_RUN=true
      shift
      ;;
    --help|-h)
      show_help
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      echo "Run './bump-deps.sh --help' for usage." >&2
      exit 1
      ;;
  esac
done

if ! [[ "$QUARANTINE_HOURS" =~ ^[0-9]+$ ]]; then
  echo "ERROR: quarantine hours must be a non-negative integer, got '$QUARANTINE_HOURS'" >&2
  exit 1
fi

if ! command -v deno >/dev/null 2>&1; then
  echo "ERROR: deno is required" >&2
  exit 1
fi

read_neat_core_rev() {
  deno eval '
const cfg = JSON.parse(Deno.readTextFileSync("deno.json"));
console.log(cfg.neatCore?.rev ?? "");
' 2>/dev/null || echo ""
}

write_imports_to_file() {
  # Read deno.json imports and write them as JSON to "$1". Pass the
  # destination path through the environment so we never need bash's
  # ${var@Q} (bash 4.4+) — macOS still ships bash 3.2.
  BUMP_DEPS_OUT_PATH="$1" deno eval '
const out = Deno.env.get("BUMP_DEPS_OUT_PATH");
if (!out) { console.error("BUMP_DEPS_OUT_PATH unset"); Deno.exit(2); }
const cfg = JSON.parse(Deno.readTextFileSync("deno.json"));
Deno.writeTextFileSync(out, JSON.stringify(cfg.imports ?? {}, null, 2));
'
}

compute_imports_diff() {
  # Print "key: before -> after" lines for any key whose value differs
  # between the JSON files at $1 (before) and $2 (after).
  # shellcheck disable=SC2016 # JS template literals — must not be expanded by bash
  BUMP_DEPS_BEFORE_PATH="$1" BUMP_DEPS_AFTER_PATH="$2" deno eval '
const beforePath = Deno.env.get("BUMP_DEPS_BEFORE_PATH");
const afterPath = Deno.env.get("BUMP_DEPS_AFTER_PATH");
if (!beforePath || !afterPath) {
  console.error("diff paths unset");
  Deno.exit(2);
}
const a = JSON.parse(Deno.readTextFileSync(beforePath));
const b = JSON.parse(Deno.readTextFileSync(afterPath));
const out = [];
for (const k of new Set([...Object.keys(a), ...Object.keys(b)])) {
  if (a[k] !== b[k]) {
    out.push(`${k}: ${a[k] ?? "<new>"} -> ${b[k] ?? "<removed>"}`);
  }
}
console.log(out.join("\n"));
'
}

INTERNAL_BEFORE="$(read_neat_core_rev)"
INTERNAL_AFTER="$INTERNAL_BEFORE"

# --- Internal: NEAT-AI-core neatCore.rev --------------------------------
if [[ "$SKIP_INTERNAL" == true ]]; then
  echo "Skipping internal bump (NEAT-AI-core neatCore.rev)."
elif [[ "$DRY_RUN" == true ]]; then
  echo "[dry-run] would invoke ./build.sh to advance neatCore.rev to Develop HEAD"
else
  echo "Bumping internal: NEAT-AI-core neatCore.rev -> Develop HEAD via ./build.sh"
  if ! ./build.sh; then
    echo "ERROR: ./build.sh failed; internal bump aborted." >&2
    exit 1
  fi
  INTERNAL_AFTER="$(read_neat_core_rev)"
fi

# --- External: Deno deps via `deno outdated` ----------------------------
EXTERNAL_DIFF=""
EXTERNAL_BUMPED_COUNT=0

if [[ "$SKIP_EXTERNAL" == true ]]; then
  echo "Skipping external bump (Deno imports)."
elif [[ "$DRY_RUN" == true ]]; then
  echo "[dry-run] would run: deno outdated --update --latest" \
       "--minimum-dependency-age=$((QUARANTINE_HOURS * 60))"
else
  QUARANTINE_MINUTES=$((QUARANTINE_HOURS * 60))
  tmp_dir="$(mktemp -d)"
  trap 'rm -rf "$tmp_dir"' EXIT
  before_file="$tmp_dir/imports.before.json"
  after_file="$tmp_dir/imports.after.json"
  write_imports_to_file "$before_file"

  echo "Bumping external: deno outdated --update --latest" \
       "--minimum-dependency-age=${QUARANTINE_MINUTES} (= ${QUARANTINE_HOURS}h)"
  outdated_log="$tmp_dir/outdated.log"
  if ! deno outdated --update --latest \
      "--minimum-dependency-age=${QUARANTINE_MINUTES}" \
      >"$outdated_log" 2>&1; then
    cat "$outdated_log" >&2 || true
    echo "ERROR: 'deno outdated' failed; external bump aborted." >&2
    exit 1
  fi

  write_imports_to_file "$after_file"
  if ! diff -q "$before_file" "$after_file" >/dev/null 2>&1; then
    EXTERNAL_DIFF="$(compute_imports_diff "$before_file" "$after_file" || true)"
    if [[ -n "$EXTERNAL_DIFF" ]]; then
      EXTERNAL_BUMPED_COUNT="$(printf '%s\n' "$EXTERNAL_DIFF" | wc -l | tr -d ' ')"
    fi
  fi
fi

# --- Audit gate: deno check ---------------------------------------------
if [[ "$DRY_RUN" != true ]]; then
  echo "Audit gate: running 'deno check'..."
  audit_log="$(mktemp)"
  trap 'rm -f "$audit_log"' EXIT
  if ! deno check >"$audit_log" 2>&1; then
    cat "$audit_log" >&2 || true
    echo "" >&2
    echo "ERROR: 'deno check' failed after dependency bumps." >&2
    if [[ -n "$EXTERNAL_DIFF" ]]; then
      echo "Offending external bump(s):" >&2
      printf '%s\n' "$EXTERNAL_DIFF" | sed 's/^/  /' >&2
    fi
    if [[ "$INTERNAL_BEFORE" != "$INTERNAL_AFTER" ]]; then
      echo "Internal neatCore.rev advanced: ${INTERNAL_BEFORE:0:7} -> ${INTERNAL_AFTER:0:7}" >&2
    fi
    echo "Worker should revert per VibeCoding#1613." >&2
    exit 1
  fi
fi

# --- Summary ------------------------------------------------------------
parts=()
if [[ "$INTERNAL_BEFORE" != "$INTERNAL_AFTER" ]]; then
  parts+=("neatCore.rev ${INTERNAL_BEFORE:0:7} -> ${INTERNAL_AFTER:0:7}")
fi
if [[ "$EXTERNAL_BUMPED_COUNT" -gt 0 ]]; then
  parts+=("${EXTERNAL_BUMPED_COUNT} external dep(s)")
fi

if [[ "$DRY_RUN" == true ]]; then
  echo "✅ dry-run complete (no changes written)"
elif [[ ${#parts[@]} -eq 0 ]]; then
  echo "✅ no bumps — dependencies already current"
else
  # Cross-platform safe array join (bash 3.2 lacks "${arr[*]/IFS}" idioms).
  joined="${parts[0]}"
  for ((i = 1; i < ${#parts[@]}; i++)); do
    joined+="; ${parts[i]}"
  done
  echo "✅ bumped: ${joined}"
  if [[ -n "$EXTERNAL_DIFF" ]]; then
    printf '%s\n' "$EXTERNAL_DIFF" | sed 's/^/  /'
  fi
fi
