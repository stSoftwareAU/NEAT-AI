## Summary

Prepared NEAT-AI CI for the future migration to the external **NEAT-AI-core**
crate (parent epic #2341). The worker that produced this branch cannot push
`.github/workflows/*.yml` (no `workflow` OAuth scope), so the plumbing is
delivered as tested helper scripts + documentation that a follow-up PR can wire
into the workflows verbatim. Closes #2344.

What landed:

- `scripts/rust-ci-cache-key.sh` — emits a stable cache key that hashes
  `wasm_activation/Cargo.toml`, `Cargo.lock` (when present), `build.sh`, and the
  extracted git coordinates (`git` / `rev` / `tag` / `branch`) from both
  manifests. A NEAT-AI-core `rev` bump in Cargo.toml busts the cache cleanly.
- `scripts/rust-ci-git-auth.sh` — exports `CARGO_NET_GIT_FETCH_WITH_CLI=true`
  and, when `CARGO_GIT_TOKEN` (preferred) or `GITHUB_TOKEN` is set, installs a
  `git config --global url.*.insteadOf` rewrite so Cargo can fetch a private
  NEAT-AI-core. Safe no-op when no secret is supplied.
- `docs/CI_EXTERNAL_NEAT_AI_CORE.md` — authentication guidance, cache-key usage,
  and confirmation by direct inspection that `wasm-build.yml` only builds the
  in-tree `wasm_activation` crate (§3).

Acceptance criteria from the issue:

- [x] Git dependencies authenticate without manual secrets beyond what org
      policy already allows (`rust-ci-git-auth.sh`).
- [x] Cache keys bust when the core git `rev` changes (`rust-ci-cache-key.sh` +
      unit tests).
- [x] WASM jobs only build in-tree `wasm_activation` and are not blocked by the
      core split (documented in §3 of `CI_EXTERNAL_NEAT_AI_CORE.md`).

## Evidence

Backend/CLI change — no UI. Verified via unit tests and direct execution of the
helper scripts:

```
$ deno test test/scripts/RustCiCacheKey.ts test/scripts/RustCiGitAuth.ts
ok | 13 passed | 0 failed (310ms)

$ ./quality.sh --lint-only
[3/4] Linting... Checked 1391 files
[4/4] Checking bash scripts...
  ✅ ./scripts/rust-ci-git-auth.sh
  ✅ ./scripts/rust-ci-cache-key.sh
```

## Test Plan

- Added `test/scripts/RustCiCacheKey.ts` — 8 tests:
  - `--help` succeeds; script is executable
  - emits a non-empty hex digest
  - deterministic for identical inputs
  - key changes when `Cargo.toml` changes
  - key changes when a git dep `rev` changes
  - key changes when `Cargo.lock` is present
  - fails cleanly when `Cargo.toml` is missing
  - `--prefix` prepends a label
- Added `test/scripts/RustCiGitAuth.ts` — 5 tests:
  - script is sourceable
  - exports `configure_cargo_git_auth`
  - sets `CARGO_NET_GIT_FETCH_WITH_CLI=true`
  - is a no-op when no token is set (does not write `~/.gitconfig`)
  - installs an `insteadOf` rewrite when `CARGO_GIT_TOKEN` is set
- Existing `test/scripts/BashScriptSyntax.ts` covers the new scripts via its
  `bash -n` sweep; rerun confirms 3/3 still pass.

## Notes for reviewers

The follow-up workflow PR (by a user/token with `workflow` scope) should:

1. Add `source scripts/rust-ci-git-auth.sh && configure_cargo_git_auth` before
   any `cargo` step in `quality.yml`, `coverage.yaml`, and `wasm-build.yml`.
2. Replace the inline `hashFiles(...)` cache key in `wasm-build.yml` with the
   shared helper:

   ```bash
   scripts/rust-ci-cache-key.sh --prefix ${{ runner.os }}-cargo-wasm
   ```
3. Leave the WASM job scope unchanged — it is already correct.
