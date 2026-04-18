# CI for the external NEAT-AI-core dependency

**Status:** preparatory work landed ahead of the
[parent epic #2341](https://github.com/stSoftwareAU/NEAT-AI/issues/2341). Issue
#2344 delivers the CI plumbing so a clean PR against `Develop` will keep
building once shared Rust moves to the separate
[NEAT-AI-core](https://github.com/stSoftwareAU/NEAT-AI-core) repository.

**Scope.** `wasm_activation/` stays in-tree. This document covers the auth,
cache, and job-scope concerns specific to consuming NEAT-AI-core as an external
git dependency.

## 1. Git dependency authentication

Cargo fetches git dependencies using its own native git client by default, which
does not pick up the `extraheader` credential that `actions/checkout@v4` injects
for `GITHUB_TOKEN`. Set `CARGO_NET_GIT_FETCH_WITH_CLI=true` so cargo shells out
to the system `git` binary and inherits that credential.

Use the helper:

```yaml
- name: Configure cargo git auth
  run: |
    source scripts/rust-ci-git-auth.sh
    configure_cargo_git_auth
  env:
    # Only needed when NEAT-AI-core is private and GITHUB_TOKEN does
    # not cover it. Supply a fine-grained PAT or deploy key via repo
    # secrets. Leave unset for public crates.
    CARGO_GIT_TOKEN: ${{ secrets.NEAT_AI_CORE_PAT }}
```

Behaviour:

- Always exports `CARGO_NET_GIT_FETCH_WITH_CLI=true`.
- If `CARGO_GIT_TOKEN` (preferred) or `GITHUB_TOKEN` is set, installs a
  `git config --global url.*.insteadOf` rewrite so every
  `https://github.com/...` fetch uses token auth.
- Safe no-op when no token is provided — does not touch `~/.gitconfig`.

No secret is required beyond what org policy already grants the workflow
(`GITHUB_TOKEN`). A dedicated secret is only needed if the core crate is private
and lives outside the default token's visibility.

## 2. Cache keys that invalidate on a core `rev` bump

The existing wasm-build workflow keys its cache on
`hashFiles('wasm_activation/Cargo.toml', 'wasm_activation/build.sh')`. That
already invalidates when a new `rev = "..."` line is written into `Cargo.toml`,
but the hash is sensitive to any whitespace reshuffle and does not hash
`Cargo.lock`.

Prefer the dedicated helper, which hashes Cargo.toml, Cargo.lock (when present),
build.sh, and the extracted git coordinates (`git` / `rev` / `tag` / `branch`)
so the key busts cleanly on a NEAT-AI-core repin:

```yaml
- name: Compute Rust cache key
  id: cachekey
  run: |
    echo "key=$(scripts/rust-ci-cache-key.sh \
      --prefix ${{ runner.os }}-cargo-wasm)" >> "$GITHUB_OUTPUT"

- name: Cache Cargo (registry + git + target)
  uses: actions/cache@v4
  with:
    path: |
      ~/.cargo/registry
      ~/.cargo/git
      wasm_activation/target
    key: ${{ steps.cachekey.outputs.key }}
    restore-keys: |
      ${{ runner.os }}-cargo-wasm-
```

The helper is covered by unit tests in
[`test/scripts/RustCiCacheKey.ts`](../test/scripts/RustCiCacheKey.ts):

- deterministic for identical inputs,
- key changes when `Cargo.toml` changes,
- key changes when a git dep `rev` changes,
- key changes when `Cargo.lock` appears,
- fails cleanly when `Cargo.toml` is missing.

## 3. WASM jobs stay scoped to `wasm_activation`

Confirmed by inspection of `.github/workflows/wasm-build.yml`:

- The `wasm_activation` job runs only `./wasm_activation/build.sh`, which in
  turn invokes `wasm-pack build --target web --release
  --out-dir pkg` inside
  `wasm_activation/`.
- The cache path is limited to `wasm_activation/target` plus the shared cargo
  caches (`~/.cargo/registry`, `~/.cargo/git`).
- The fingerprint step hashes only `wasm_activation/Cargo.toml`,
  `wasm_activation/src/lib.rs`, and `wasm_activation/build.sh`.
- The commit/upload steps operate on `wasm_activation/pkg` only.

Nothing in the WASM pipeline reaches into shared Rust that will live in
NEAT-AI-core, so the core split does not block WASM builds.

## 4. Applying the changes to the workflow

`scripts/rust-ci-cache-key.sh` and `scripts/rust-ci-git-auth.sh` land on the
branch for this issue and are fully tested. The workflow YAML itself is updated
in a follow-up PR raised with a token that carries the `workflow` OAuth scope —
the CI worker that produced this branch does not have that scope, so it cannot
push changes under `.github/workflows/`.

The follow-up PR only needs to:

1. Add a `configure cargo git auth` step before any `cargo` invocation in
   `quality.yml`, `coverage.yaml`, and `wasm-build.yml`.
2. Replace the inline `hashFiles(...)` cache key in `wasm-build.yml` with a call
   to `scripts/rust-ci-cache-key.sh --prefix ...`.
3. Leave the WASM job otherwise unchanged — its scope is already correct.

## Acceptance checklist (issue #2344)

- [x] Helper to enable git-dep auth on CI without extra secrets beyond the
      default `GITHUB_TOKEN` (`scripts/rust-ci-git-auth.sh`).
- [x] Cache key helper that invalidates when the core git `rev` changes
      (`scripts/rust-ci-cache-key.sh`).
- [x] WASM jobs verified to build only in-tree `wasm_activation` and are not
      blocked by the core split (see §3).
