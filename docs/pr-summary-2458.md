## Summary

Cleared the pre-existing quality baseline so the worker's baseline-aware
quality gate has zero slack on this repo. Closes #2458.

Findings enumerated against the default branch:

| Tool          | Findings before | Findings after |
| ------------- | --------------: | -------------: |
| `shellcheck`  |               2 |              0 |
| `deno lint`   |               4 |              0 |
| `deno check`  |               0 |              0 |

Changes are lint-only — no behaviour change.

## Evidence

### Shellcheck (info-level `SC2016`, false positives)

`build.sh` and `bump-deps.sh` pass JS source to `deno eval` inside single
quotes. The `${...}` sequences are JavaScript template literals and must
not be expanded by bash, so the warning is a false positive. Suppressed
locally with `# shellcheck disable=SC2016` on the offending lines, with
a comment explaining why.

```
$ shellcheck ./bench/binaryFormat/run.sh ./quality.sh ./build.sh \
    ./scripts/parity-gate.sh ./bump-deps.sh
$ echo $?
0
```

### Deno lint

Three findings in one-off migration scripts under `scripts/`:

- `scripts/revert-and-patch-v2.ts:55` — `const original = content;` was
  declared but never read. Removed.
- `scripts/revert-and-patch-v2.ts:154` — `// deno-lint-ignore no-explicit-any`
  comment had no `any` to suppress. Removed.
- `scripts/comprehensive-patch.ts:269` — `let fixedHead = 0;` was declared
  but never read or assigned. Removed.

```
$ deno lint
Checked 1487 files
$ echo $?
0
```

### Deno check

Already clean against the default branch — re-verified after the changes.

```
$ ./quality.sh --check-only < /dev/null
$ echo $?
0
```

## Test Plan

This is a lint-only cleanup with no runtime behaviour change, so no new
unit tests are added. Verification is via the quality gate itself:

- [x] `./quality.sh --lint-only < /dev/null` passes (formatting, lint,
      bash script check).
- [x] `./quality.sh --check-only < /dev/null` passes (type-check).
- [x] `shellcheck` against every `.sh` file under the repo root and
      `scripts/` exits 0.
- [x] `deno lint` reports 0 problems across 1487 files.

A future baseline capture on this repo should now report
`findingCount=0` for shellcheck, deno lint, and deno check.
