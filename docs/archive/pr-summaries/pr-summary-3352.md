## Summary

Hardened the `dependency-review` workflow's checkout step against credential
persistence. `actions/checkout` writes the workflow's `GITHUB_TOKEN` into
`.git/config` as an auth header by default, where any later step — including a
compromised dependency — could read it and act as the token. The
`dependency-review` job only checks out the repo to scan changed dependency
manifests; it never pushes back or fetches private submodules, so it does not
need the persisted credential. Added `persist-credentials: false` to the
checkout step to keep the token off disk and narrow the blast radius of a
compromised step. This matches the existing pattern already used across sibling
workflows (`actionlint.yml`, `osv-scan.yml`, `pages.yml`, `quality.yml`).

Closes #3352.

## Evidence

Backend/CI-only change — no web interface to screenshot. The affected file is a
GitHub Actions workflow YAML; the relevant validation gate is `actionlint`,
which passes cleanly:

```
actionlint .github/workflows/dependency-review.yml
actionlint exit: 0
```

The diff adds a `with:` block to the existing checkout step:

```yaml
      - name: "Checkout repository"
        # actions/checkout@v6.0.2
        uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
        with:
          persist-credentials: false
      - name: "Dependency Review"
```

## Test Plan

- Ran `actionlint .github/workflows/dependency-review.yml` — exit 0, no
  warnings.
- Verified the fix mirrors the already-present `persist-credentials: false`
  usage in `actionlint.yml`, `osv-scan.yml`, `pages.yml`, and `quality.yml`.
- The `dependency-review` job performs no push or private-submodule fetch, so
  removing the persisted credential does not affect its behaviour.
