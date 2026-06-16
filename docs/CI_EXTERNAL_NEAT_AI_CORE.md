# CI for the external NEAT-AI-core dependency

> **Brief:** Continuous Integration (CI) here never builds Rust or resolves
> NEAT-AI-core HEAD. It only **verifies** that the vendored
> [WebAssembly (WASM)](GLOSSARY.md#-acronyms) bundle `wasm_activation/pkg/**`
> matches the SHA pinned in `deno.json`. For the cluster overview start at
> [docs/EXTERNAL_NEAT_AI_CORE.md](EXTERNAL_NEAT_AI_CORE.md).

## What the workflows do today

The two workflows that touch the NEAT-AI-core dependency both call
`./build.sh --verify-only`. The verify-only mode performs no network calls and
no mutation — it simply checks that the on-disk `wasm_activation/pkg/**` matches
`deno.json` `neatCore.rev`.

| Workflow                                                            | Job       | Step                                                 | Command                    |
| ------------------------------------------------------------------- | --------- | ---------------------------------------------------- | -------------------------- |
| [`.github/workflows/quality.yml`](../.github/workflows/quality.yml) | `quality` | _Sync WASM package from NEAT-AI-core_                | `./build.sh --verify-only` |
| [`.github/workflows/publish.yml`](../.github/workflows/publish.yml) | `publish` | _Verify WASM package matches deno.json neatCore.rev_ | `./build.sh --verify-only` |

The publish workflow uses verify-only deliberately: the default `GITHUB_TOKEN`
cannot read commits from `NEAT-AI-core`, so any attempt to resolve `Develop`
HEAD from the publish job would fail (see
[`docs/CORE_DEPENDENCY_POLICY.md`](CORE_DEPENDENCY_POLICY.md) and Issue #2439).

## Required workflow pattern

If you add another workflow that needs the WASM bundle, follow this pattern —
verify only, never resolve HEAD:

```yaml
- name: Setup Deno
  uses: denoland/setup-deno@v2

- name: Verify WASM package matches deno.json neatCore.rev
  run: ./build.sh --verify-only
```

Place this step before any `deno check`, `deno test`, or publish step. Bumping
`neatCore.rev` is an explicit human (or worker) action, not something CI does on
its own.

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
