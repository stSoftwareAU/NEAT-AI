# CI for the external NEAT-AI-core dependency

CI in this repository no longer builds Rust. It always syncs prebuilt WASM
artifacts from NEAT-AI-core using `./build.sh`.

## Required workflow pattern

```yaml
- name: Setup Deno
  uses: denoland/setup-deno@v2

- name: Sync WASM package from NEAT-AI-core
  run: ./build.sh
```

Add this before `deno check`, `deno test`, or publish.

## Sync policy enforcement

CI should fail when `wasm_activation/pkg/**` changes without a paired change to
`deno.json` `neatCore.rev`.

Example guard:

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
- `wasm_activation/pkg` remains committed and published with the package.
