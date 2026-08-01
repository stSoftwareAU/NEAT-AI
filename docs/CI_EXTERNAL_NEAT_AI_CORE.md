# CI for the external NEAT-AI-core dependency

> **Brief:** Continuous Integration (CI) here never builds Rust or resolves
> NEAT-AI-core HEAD. It only **verifies** that the vendored
> [WebAssembly (WASM)](GLOSSARY.md#-acronyms) bundle `wasm_activation/pkg/**`
> matches the SHA pinned in `deno.json`. For the cluster overview start at
> [docs/EXTERNAL_NEAT_AI_CORE.md](EXTERNAL_NEAT_AI_CORE.md).

## What the workflows do today

Every job that touches the NEAT-AI-core dependency calls
`./build.sh --verify-only`. The verify-only mode performs no network calls and
no mutation — it simply checks that the on-disk `wasm_activation/pkg/**` matches
`deno.json` `neatCore.rev`.

Since Issue #3608 that call lives in exactly one file — the local composite
action [`.github/actions/setup-neat`](../.github/actions/setup-neat/action.yml),
which installs Deno 2.x and then runs the verify step. Jobs reach it via
`uses: ./.github/actions/setup-neat`:

| Workflow                                                                | Job                         | WASM sync |
| ----------------------------------------------------------------------- | --------------------------- | --------- |
| [`.github/workflows/quality.yml`](../.github/workflows/quality.yml)     | `quality`                   | yes       |
| [`.github/workflows/coverage.yaml`](../.github/workflows/coverage.yaml) | `coverage`                  | yes       |
| [`.github/workflows/coverage.yaml`](../.github/workflows/coverage.yaml) | `merge`                     | no        |
| [`.github/workflows/bench.yaml`](../.github/workflows/bench.yaml)       | `smoke`                     | yes       |
| [`.github/workflows/bench.yaml`](../.github/workflows/bench.yaml)       | `score-per-hour-regression` | yes       |
| [`.github/workflows/publish.yml`](../.github/workflows/publish.yml)     | `publish`                   | yes       |

The `merge` job only aggregates shard artefacts and never loads the bundle, so
it opts out with `verify-wasm: "false"`.

The publish workflow uses verify-only deliberately: the default `GITHUB_TOKEN`
cannot read commits from `NEAT-AI-core`, so any attempt to resolve `Develop`
HEAD from the publish job would fail (see
[`docs/CORE_DEPENDENCY_POLICY.md`](CORE_DEPENDENCY_POLICY.md) and Issue #2439).

## Required workflow pattern

If you add another job that needs the WASM bundle, reuse the composite action
rather than re-pinning `denoland/setup-deno` and re-typing the verify command:

```yaml
- name: Checkout Code
  # actions/checkout@v6.0.2
  uses: actions/checkout@de0fac2e4500dabe0009e67214ff5f5447ce83dd
  with:
    persist-credentials: false

- name: Setup Deno and sync WASM package
  uses: ./.github/actions/setup-neat
```

`actions/checkout` stays inline: a local `uses: ./…` action is loaded from
`$GITHUB_WORKSPACE`, so the repository must already be checked out before the
composite action can be read.

Place the composite step before any `deno check`, `deno test`, or publish step.
Bumping `neatCore.rev` is an explicit human (or worker) action, not something CI
does on its own.

## Sync policy enforcement

`wasm_activation/pkg/**` must change only in commits that also change
`deno.json` `neatCore.rev`. The contributor-facing rule lives in
[`docs/CORE_DEPENDENCY_POLICY.md`](CORE_DEPENDENCY_POLICY.md); the CI side is
the _Report WASM sync changes_ step in
[`.github/workflows/quality.yml`](../.github/workflows/quality.yml), which
surfaces a notice when `wasm_activation/pkg/` has changed after the verify step.
If you need a hard guard that fails the build, the following pattern works:

```yaml
- name: Verify WASM sync policy
  run: |
    changed="$(git diff --name-only)"
    if echo "$changed" | grep -q '^wasm_activation/pkg/' && \
       ! echo "$changed" | grep -q '^deno.json$'; then
      echo "wasm_activation/pkg changed without deno.json pin change" >&2
      exit 1
    fi
```

## Notes

- No Cargo cache, `rustc`, or `wasm-pack` setup is needed in this repo.
- `wasm_activation/pkg` remains committed and published with the package via
  [`.github/workflows/publish.yml`](../.github/workflows/publish.yml).
- The release-wide CI gate is `./quality.sh`, which calls
  `./build.sh --verify-only` for the same reason the workflow does.

## See also

- [`docs/EXTERNAL_NEAT_AI_CORE.md`](EXTERNAL_NEAT_AI_CORE.md) — cluster overview
  and day-to-day workflow.
- [`docs/CORE_DEPENDENCY_POLICY.md`](CORE_DEPENDENCY_POLICY.md) — the ADR for
  the pinning model and CI policy this workflow enforces.
- [`docs/PARITY_GATE.md`](PARITY_GATE.md) — release checklist run after bumping
  the pinned revision.

---

**Up to:** [`README.md`](../README.md) (entry point) ·
[`docs/README.md`](README.md) (topic index).
