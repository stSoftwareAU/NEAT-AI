## Summary

Strengthened the Semgrep SAST workflow by adding two explicitly
security-focused rule packs (`p/security-audit` and `p/owasp-top-ten`)
alongside the existing broad `p/default` pack. `SECURITY.md` already
advertises Semgrep as the project's SAST gate, but `p/default` only
lightly overlaps with security rules — the additional packs materially
raise the bar without adding noise to pre-existing code (`semgrep ci`
suppresses pre-existing findings; only *new* code that introduces a
violation will fail).

Closes #2698.

## Evidence

`.github/workflows/semgrep.yml` now runs:

```yaml
- run: semgrep ci --config p/default --config p/security-audit --config p/owasp-top-ten
```

This is a CI configuration change with no runtime/web interface to
screenshot. Verification is via the new regression test
`test/ci/SemgrepRulePacks.ts`, which parses the workflow YAML and
asserts the configured rule packs:

```text
running 5 tests from ./test/ci/SemgrepRulePacks.ts
extractSemgrepConfigs parses a single --config flag ... ok
extractSemgrepConfigs captures multiple packs ... ok
extractSemgrepConfigs returns empty for no --config flags ... ok
semgrep.yml retains the p/default rule pack (Issue #2698) ... ok
semgrep.yml runs a security-focused rule pack (Issue #2698) ... ok

ok | 5 passed | 0 failed
```

## Test Plan

- Added `test/ci/SemgrepRulePacks.ts` covering:
  - Parser unit tests (`extractSemgrepConfigs`): single pack, multiple
    packs, and zero packs.
  - Regression test asserting `p/default` is retained in
    `.github/workflows/semgrep.yml`.
  - Regression test asserting at least one of `p/security-audit` or
    `p/owasp-top-ten` is present, satisfying the issue's acceptance
    criterion.
- `./quality.sh --lint-only` and `./quality.sh --check-only` both pass
  cleanly with the new file.
