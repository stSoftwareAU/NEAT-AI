## Summary

Documents the project's "no `@std/log`" logging policy. NEAT-AI uses its own
pluggable `Logger` abstraction in `src/utils/Logger.ts` (introduced in #1398)
and must never depend on `@std/log` — direct or transitive — because that
package is marked unstable on JSR and the in-tree `Logger` interface is already
consumer-pluggable. Closes #2480.

Documentation-only — no code under `src/` was changed.

## Changes

- **`AGENTS.md`** — new `📝 Logging Policy` section (placed directly after the
  Style section, before Testing) that:
  - Names `@std/log` and explains why it must not be used.
  - Lists four explicit rules (use `getLogger()`, no `@std/log` import, inject
    custom `Logger` for external integrations, raise issues against
    `src/utils/Logger.ts` for missing features).
  - Includes a 5–10 line code example showing both injection paths
    (`NeatOptions.logger` and `setLogger()`).
  - Documents the audit commands so anyone can re-verify the zero-reference
    state.
- **`CONTRIBUTING.md`** — short cross-reference under `🎨 Code Style` linking to
  the new AGENTS.md policy section, with the headline rule duplicated for
  visibility.

## Evidence — Audit (zero `@std/log` references)

```
$ grep -r '@std/log\|jsr:@std/log' src test mod.ts deno.json
$ deno info --json mod.ts | grep -o '"specifier": "[^"]*"' | grep '@std/log' \
    || echo 'no @std/log dependency'
no @std/log dependency
```

Both commands return empty / "no @std/log dependency" — the current tree has
zero `@std/log` references and this PR locks that state in via documentation.

## Test Plan

- Documentation-only change. No new tests required.
- `./quality.sh --lint-only` passes — formatting, lint, and bash script syntax
  checks succeed.
- The companion sub-issue (referenced from #2479) covers the automated guardrail
  test that locks the same state in via assertion.

## Acceptance Criteria

- [x] `AGENTS.md` contains a new "Logging Policy" section that names `@std/log`
      and explains why it must not be used.
- [x] The section includes a short code example showing how a consumer injects a
      custom `Logger` via `NeatOptions` / `setLogger()`.
- [x] `CONTRIBUTING.md` links to the new AGENTS.md section and duplicates the
      headline rule for visibility.
- [x] PR description includes the audit grep / `deno info` output proving zero
      `@std/log` references exist today.
- [x] `./quality.sh` lint pass succeeds.
- [x] No source code under `src/` is changed — documentation-only PR.
