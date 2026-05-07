# 🔄 CI / quality.sh Troubleshooting

This document covers CI (Continuous Integration) and local quality-gate
failures: the `coverage.yaml` workflow's two-stage retry strategy, exit-code
meanings, and `quality.sh` step-by-step. See the index in
[`../TROUBLESHOOTING.md`](../TROUBLESHOOTING.md) for other categories.

## 📋 Understanding coverage.yaml

The CI workflow (`coverage.yaml`) uses a two-stage strategy:

1. **First attempt:** Detects available CPU (Central Processing Unit) cores and
   memory, then allocates resources dynamically:
   - 8+ cores and 8+ GB RAM: 70% memory, parallel enabled
   - 4+ cores and 4+ GB RAM: 60% memory, parallel enabled
   - Under 4 cores or 4 GB: 50% memory, no parallelism

2. **Retry on SIGTERM:** If exit code 143 (OOM — out-of-memory — kill), retries
   with:
   - 50% of original memory allocation (minimum 512 MB)
   - Parallelism disabled
   - Minimum 1 GB floor

**Exit code meanings:**

| Exit Code | Meaning            | CI Action               |
| --------- | ------------------ | ----------------------- |
| 0         | All tests passed   | Proceed to coverage     |
| 1         | Test failures      | Report failure          |
| 143       | SIGTERM (OOM kill) | Retry with lower memory |
| Other     | Unexpected error   | Fail the job            |

## 🔧 quality.sh failures

The `quality.sh` script runs these steps in order:

1. `deno outdated --update --latest` — Update dependencies
2. `deno fmt` — Format code
3. `deno lint --fix` — Lint with auto-fix
4. Bash syntax check — Validates `.sh` files
5. Discovery library check — Validates Rust library availability
6. `deno check` — Type-check
7. `deno test` — Run all tests with leak detection

If discovery checks fail with exit codes 137 or 9 (segfault), the script
provides diagnostic guidance. See
[Discovery troubleshooting → Architecture mismatch](DISCOVERY.md#-architecture-mismatch-errors-arm64-vs-x86).

## See also

- [Memory troubleshooting](MEMORY.md) — for the OOM retry logic referenced
  above.
- [Discovery troubleshooting](DISCOVERY.md) — segfault / exit-code-137 diagnosis
  when the discovery library is broken.
- [`../../CONTRIBUTING.md`](../../CONTRIBUTING.md) — full quality-gate workflow
  for contributors.

---

**Up to:** [`README.md`](../../README.md) (entry point) ·
[`docs/README.md`](../README.md) (topic index).
