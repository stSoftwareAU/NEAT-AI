# PR Summary — Refresh Discovery & TS ↔ Rust FFI docs

## Summary

Refresh the four docs in the Discovery / FFI cluster so they read as a coherent
stack:

- **`docs/DISCOVERY_GUIDE.md`** — added a brief summary block at the top with
  links to its siblings (`DISCOVERY_ARCHITECTURE.md`, `DISCOVERY_DIR.md`,
  `GPU_ACCELERATION.md`, `EXTERNAL_NEAT_AI_CORE.md`, and `docs/README.md`).
  Expanded acronyms (FFI, GPU, WASM, API) on first use; updated the See Also
  list to include `TS_RUST_MIGRATION.md`.
- **`docs/DISCOVERY_ARCHITECTURE.md`** — added a top-level summary block, a new
  Mermaid `flowchart` showing the full TS host → FFI bridge → Rust extension →
  `wgpu` → result path, and an `[!IMPORTANT]` callout reconciling the FFI wire
  contract with `AGENTS.md` §"Neuron UUID stability" (UUID-only payloads, no
  numeric IDs across the boundary). Refreshed the See Also list.
- **`docs/DISCOVERY_DIR.md`** — added a summary block, a new "On-disk discovery
  cache layout" section with a directory tree and Mermaid graph, and a UUID
  resolution sub-section that documents the `loadFrom` UUID-first rule. Expanded
  acronyms; added a See Also section.
- **`docs/TS_RUST_MIGRATION.md`** — full rewrite: current "where things live"
  matrix backed by PR / issue references, UUID-only wire-format invariant,
  Mermaid `gitGraph` migration timeline, evidence table of selected migration
  PRs, and roadmap split into Phase 1 (foundation) and Phase 2 (selective
  migration). Replaced the previous WASM-only roadmap, which omitted the FFI
  Discovery extension and recent core extraction milestones.

Closes #2569.

## Evidence

This PR is documentation-only; no executable code changed. Evidence for
reviewers:

- `./quality.sh --lint-only < /dev/null` — passes (deno fmt + lint + bash
  shellcheck, 2212 files formatted, 1539 linted).
- `npx markdownlint-cli2 docs/DISCOVERY_GUIDE.md docs/DISCOVERY_ARCHITECTURE.md
  docs/DISCOVERY_DIR.md docs/TS_RUST_MIGRATION.md < /dev/null`
  — 0 errors across 600 files (project-wide config respected).
- All acronyms (FFI, wgpu, GPU, UUID, JSON, WASM, API, CPU, LRU, PR) are
  expanded or linked on first use within each refreshed file.
- Each file starts with a `> Summary` block linking to its siblings; the cluster
  diagram from the issue is preserved by the in-prose links.
- Every "moved" claim in `TS_RUST_MIGRATION.md` is backed by a PR or issue
  number (e.g. `#2442` for TS fallback removal, `#1377/#1519/#1526` for elastic
  distribution, `#2369/#2374` for the `wasm_activation` parity audit).

### Cross-reference check

| Acceptance criterion                                                | Where satisfied                                                             |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| Each file starts with a brief summary linking siblings              | Top of all four files                                                       |
| `DISCOVERY_ARCHITECTURE.md` has a Mermaid TS ↔ Rust FFI diagram     | New "TS host ↔ Rust extension data flow" section                            |
| `DISCOVERY_DIR.md` describes cache directory with diagram or tree   | New "On-disk discovery cache layout" section (text tree + Mermaid graph)    |
| `TS_RUST_MIGRATION.md` reflects current state with PR links         | "Where things live today" table + "Evidence — selected migration PRs" table |
| Acronyms expanded on first use                                      | Summary block in each file expands FFI / GPU / WASM / UUID / JSON etc.      |
| Cross-references to `docs/README.md` and `EXTERNAL_NEAT_AI_CORE.md` | See Also section in each file                                               |
| Australian English spelling                                         | Consistent (`organisation`, `behaviour`, `optimised`, `recognise`)          |
| `./quality.sh --lint-only` passes                                   | Verified (output above)                                                     |

## Test Plan

- [x] `./quality.sh --lint-only < /dev/null` — exits 0.
- [x] `npx --yes markdownlint-cli2 docs/DISCOVERY_*.md docs/TS_RUST_MIGRATION.md
      < /dev/null`
      — 0 errors.
- [x] Manual review of each Mermaid block (flowchart, gitGraph) for parsable
      syntax — single-quoted IDs, no stray brackets.
- [x] No source code changed; existing test suite unaffected.
