# Docs audit: README.md (top-level entry point)

## Summary

Phase 1 of the documentation audit (#2956): fact-checked and refreshed the
top-level `README.md` so the project's front door is accurate, runnable, and
links out to the glossary. Closes #2959.

Changes:

- **Quick Start now runs as written.** The old snippet was a bare
  `creature.discoveryDir(...)` fragment with no import, no `creature`, and no
  `dataDir` — it could not run, and `discoveryDir()` silently needs the optional
  Rust extension. Replaced it with a complete, copy-paste-runnable example
  (`import { Creature }` from the JSR package → `new Creature(2, 1, …)` →
  `activate()` → `exportJSON()`/`fromJSON()` round-trip) that runs purely in
  WASM. The discovery snippet is kept as a follow-on step and now explicitly
  flagged as requiring the optional
  [NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery)
  extension. The example was verified against the current `mod.ts` (output
  `Float32Array(1)`, clone restored).
- **Links onward to the glossary.** Added a **Glossary**
  ([`docs/GLOSSARY.md`](../../GLOSSARY.md)) entry to the Docs map so unfamiliar
  house terms (Creature, Discovery, Grafting, CRISPR, Intelligent Design, MCMC,
  FFI, WASM) resolve to their canonical definitions — satisfying the #2956
  house-style "link to the glossary" rule.
- **Fixed a stale link.** `https://deno.land/manual` (302-redirects) → the
  canonical `https://docs.deno.com/runtime/manual/`.

Verified during the audit (no change needed): every linked doc resolves
(`docs/README.md`, all topic guides, `SECURITY.md`, `CHANGELOG.md`, etc.); the
`discoveryDir()` signature and `result.improvement.changeType` shape match
`src/Creature.ts` / `src/discovery/DiscoveryRunnerTypes.ts`; the NEAT vs NEAT-AI
distinction, acronym-on-first-use, and the existing Mermaid diagrams (high-level
architecture, dependency graph, random-immigrants flow) already meet the
acceptance criteria.

## Acceptance criteria

- [x] Every feature/claim verified against current code; stale link removed.
- [x] The quick-start / working example runs as written (verified against
      `mod.ts`).
- [x] Acronyms defined on first use; themed terms now link to the glossary;
      NEAT-vs-NEAT-AI distinction explicit (`> [!IMPORTANT]` callout).
- [x] Mermaid diagrams present (architecture, dependency graph, random
      immigrants).
- [x] All internal links resolve; README links onward to `docs/README.md` and
      the glossary.

## Evidence

Documentation-only change — no web UI to screenshot. The Quick Start example was
executed against the local build:

```text
[neat-ai] running version 5.5.3 (local)
output: Float32Array(1) [ 0.060647428035736084 ]
clone neurons: 6
```

Quality gates run for this docs change:

- `deno fmt --check README.md` → clean.
- `markdownlint-cli2 README.md` → 0 errors.

## Test Plan

No code changed, so no unit tests were added. Validation was:

- Ran the new Quick Start example end-to-end against `mod.ts` (output above).
- Confirmed all README internal doc links resolve on disk.
- `deno fmt --check` and `markdownlint-cli2` both pass on the edited README.
