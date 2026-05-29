## Summary

Authenticate the `peter-evans/create-pull-request` step in
`.github/workflows/deno-outdated.yml` with the org-level `ACTIONS_PUSH` PAT and
fall back to `GITHUB_TOKEN` only when the secret is unset. Using `GITHUB_TOKEN`
directly causes GitHub to suppress downstream workflow triggers on the created
pull request — CI checks, labels, and reviewer automation never fire until
somebody pushes a new commit. Closes #2780.

This addresses the `pr-creator-token` high-severity finding raised by the
workflow best-practice auditor (Issue #1636, Issue #2102).

## Evidence

Workflow YAML change only; there is no UI to screenshot. Verified by:

- `python3 -c "import yaml; yaml.safe_load(open('.github/workflows/deno-outdated.yml'))"`
  confirms valid YAML.
- `./quality.sh --lint-only` passes (format, lint, bash script checks).

Diff applied to step at `.github/workflows/deno-outdated.yml:48`:

{% raw %}

```yaml
- uses: peter-evans/create-pull-request@5f6978faf089d4d20b00c7766989d076bb2fc7f1
  with:
    token: ${{ secrets.ACTIONS_PUSH || secrets.GITHUB_TOKEN }}
    commit-message: "chore: update Deno dependencies"
    ...
```

{% endraw %}

## Test Plan

- [x] YAML parses cleanly with `yaml.safe_load`.
- [x] `./quality.sh --lint-only` passes.
- [ ] Next scheduled (or manually dispatched) run of `Deno Dependency Updates`
      raises a PR authored under the `ACTIONS_PUSH` identity, and downstream
      checks (CI, labels) fire automatically on that PR.
