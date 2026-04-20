#!/usr/bin/env bash
# Issue #2367 - NEAT-AI-core parity audit.
#
# Compares the in-tree `neat-core/` crate (on the
# milestone/pure-rust-scorer-experiment branch) against the external
# NEAT-AI-core crate at the rev pinned in the root Cargo.toml. Prints a
# parity matrix and lists any pub/test items in the in-tree crate that
# are absent from NEAT-AI-core.
#
# Exit code: 0 when parity holds, 1 when any gap is detected.
#
# Usage:
#   ./scripts/neat-core-parity-audit.sh            # print matrix, exit non-zero on gaps
#   ./scripts/neat-core-parity-audit.sh --json     # emit raw JSON scan only
#
# Requires: git, python3.
set -euo pipefail

MODE="report"
if [[ "${1-}" == "--json" ]]; then
  MODE="json"
fi

REPO_ROOT="$(cd "$(dirname "$0")/.." && pwd)"
WORK_DIR="$(mktemp -d -t neat-core-parity.XXXXXX)"
trap 'rm -rf "$WORK_DIR"' EXIT

PINNED_REV="$(sed -nE 's/.*rev = "([0-9a-f]{40})".*/\1/p' "$REPO_ROOT/Cargo.toml" | head -n 1)"
if [[ -z "$PINNED_REV" ]]; then
  echo "error: could not parse pinned rev from Cargo.toml" >&2
  exit 2
fi

INTREE_BRANCH="${INTREE_BRANCH:-milestone/pure-rust-scorer-experiment}"
INTREE_DIR="$WORK_DIR/intree"
EXT_DIR="$WORK_DIR/ext"
mkdir -p "$INTREE_DIR" "$EXT_DIR"

# Extract in-tree neat-core/ from the milestone branch.
(cd "$REPO_ROOT" && git archive "$INTREE_BRANCH" neat-core) | tar -x -C "$INTREE_DIR"

# Clone external NEAT-AI-core and check out the pinned rev.
git clone --quiet --depth 50 --no-single-branch \
  https://github.com/stSoftwareAU/NEAT-AI-core.git "$EXT_DIR/repo"
(cd "$EXT_DIR/repo" && git checkout --quiet "$PINNED_REV")

python3 - "$INTREE_DIR/neat-core" "$EXT_DIR/repo/neat-core" "$PINNED_REV" "$MODE" <<'PY'
import json, re, sys
from pathlib import Path

intree_root = Path(sys.argv[1])
ext_root = Path(sys.argv[2])
pinned_rev = sys.argv[3]
mode = sys.argv[4]

PUB_RE = re.compile(
    r'^\s*pub(?:\s*\([^)]*\))?\s+(fn|struct|enum|type|const|static|trait)\s+([A-Za-z_][A-Za-z0-9_]*)'
)
IMPL_RE = re.compile(
    r'^\s*impl\b(?:<[^>]+>)?\s+(?:([A-Za-z0-9_:<>,\s\']+?)\s+for\s+)?([A-Za-z0-9_:<>,\s\']+?)\s*(?:where[^{]+)?\s*\{'
)
TEST_RE = re.compile(r'#\[test\]')
FN_RE = re.compile(r'^\s*(?:async\s+)?fn\s+([A-Za-z_][A-Za-z0-9_]*)')


def scan_file(path):
    items = {"pub": [], "impl": [], "tests": []}
    lines = path.read_text().splitlines()
    for i, line in enumerate(lines):
        m = PUB_RE.match(line)
        if m:
            items["pub"].append(f"pub {m.group(1)} {m.group(2)}")
        m = IMPL_RE.match(line)
        if m:
            trait, ty = m.group(1), m.group(2).strip()
            if trait:
                items["impl"].append(f"impl {trait.strip()} for {ty}")
            else:
                items["impl"].append(f"impl {ty}")
        if TEST_RE.search(line):
            for j in range(i + 1, min(i + 6, len(lines))):
                fm = FN_RE.match(lines[j])
                if fm:
                    items["tests"].append(fm.group(1))
                    break
    return items


def scan_dir(d):
    result = {}
    if not d.exists():
        return result
    for p in sorted(d.rglob("*.rs")):
        result[str(p.relative_to(d))] = scan_file(p)
    return result


data = {
    "pinned_rev": pinned_rev,
    "intree_src": scan_dir(intree_root / "src"),
    "intree_tests": scan_dir(intree_root / "tests"),
    "ext_src": scan_dir(ext_root / "src"),
    "ext_tests": scan_dir(ext_root / "tests"),
}

if mode == "json":
    print(json.dumps(data, indent=2))
    sys.exit(0)

# Build cross-file lookups for external.
ext_all_tests = set()
for bucket in ("ext_src", "ext_tests"):
    for items in data[bucket].values():
        ext_all_tests.update(items["tests"])

ext_all_pub = set()
ext_all_impl = set()
for items in data["ext_src"].values():
    ext_all_pub.update(items["pub"])
    ext_all_impl.update(items["impl"])

gaps_pub = []
gaps_impl = []
gaps_test = []
rows = []
for f in sorted(data["intree_src"].keys() | data["ext_src"].keys()):
    intree = data["intree_src"].get(f, {"pub": [], "impl": [], "tests": []})
    ext = data["ext_src"].get(f, {"pub": [], "impl": [], "tests": []})
    missing_pub = [p for p in intree["pub"] if p not in ext_all_pub]
    missing_impl = [i for i in intree["impl"] if i not in ext_all_impl]
    missing_tests = [t for t in intree["tests"] if t not in ext_all_tests]
    gaps_pub.extend((f, p) for p in missing_pub)
    gaps_impl.extend((f, p) for p in missing_impl)
    gaps_test.extend((f, t) for t in missing_tests)
    rows.append((
        f,
        len(intree["pub"]), len(ext["pub"]), missing_pub,
        len(intree["impl"]), len(ext["impl"]), missing_impl,
        len(intree["tests"]), len(ext["tests"]), missing_tests,
    ))

print(f"NEAT-AI-core parity audit @ rev {pinned_rev}")
print()
print("| File | In-tree pub | Ext pub | Miss pub | In-tree impl | Ext impl | Miss impl | In-tree tests | Ext inline | Miss tests |")
print("|---|---|---|---|---|---|---|---|---|---|")
for (f, ip, ep, mp, ii, ei, mi, it, et, mt) in rows:
    mp_s = ", ".join(mp) or "-"
    mi_s = ", ".join(mi) or "-"
    mt_s = ", ".join(mt) or "-"
    print(f"| `{f}` | {ip} | {ep} | {mp_s} | {ii} | {ei} | {mi_s} | {it} | {et} | {mt_s} |")

total_gaps = len(gaps_pub) + len(gaps_impl) + len(gaps_test)
print()
print(f"Gaps: pub={len(gaps_pub)} impl={len(gaps_impl)} tests={len(gaps_test)}")
if total_gaps:
    print()
    for f, p in gaps_pub:
        print(f"MISSING pub  {f}: {p}")
    for f, p in gaps_impl:
        print(f"MISSING impl {f}: {p}")
    for f, t in gaps_test:
        print(f"MISSING test {f}: {t}")
    sys.exit(1)

print("All in-tree pub items and tests are present in NEAT-AI-core at the pinned rev.")
PY
