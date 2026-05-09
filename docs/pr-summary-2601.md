## Summary

Updated the two highest-traffic landing pages — root [`README.md`](../README.md)
and [`docs/README.md`](./README.md) — so first-time readers immediately
understand that **NEAT-AI** extends well beyond the standard **NEAT** algorithm.
The new framing uses the **NEAT** vs **NEAT-AI** distinction codified in
[`AGENTS.md`](../AGENTS.md#-neat-vs-neat-ai--which-term-to-use) (Issue #2599).
Closes #2601.

## What changed

### Root `README.md`

- Renamed the heading from "🧬 NEAT Neural Network for DenoJS" to "🧬
  **NEAT-AI** Neural Network for DenoJS".
- Replaced the opening paragraph. The new paragraph names **NEAT-AI** as this
  project, points to the original 2002 NEAT paper for the algorithm it grew
  from, and lists the modern extensions (memetic evolution, Discovery, MCMC,
  synthetic synapses, predictive coding, Muon-style orthogonalised gradients).
- Added an `[!IMPORTANT]` callout linking to the
  [NEAT vs NEAT-AI rule in AGENTS.md](../AGENTS.md#-neat-vs-neat-ai--which-term-to-use)
  so the distinction is visible from the very first screen.
- Added a one-line preamble to **Feature Highlights** clarifying that the list
  describes NEAT-AI behaviour and that several entries are extensions beyond
  standard NEAT, with a pointer to `COMPARISON.md`.
- Updated the **High-level architecture** sentence to refer to a "NEAT-AI
  genome" (was "NEAT genome").
- Updated the docs map and Core Concepts entries for `COMPARISON.md` to read
  "how NEAT-AI compares…" instead of "how NEAT compares…", with an explicit
  mention of standard NEAT.

### `docs/README.md`

- Added an `[!IMPORTANT]` framing callout at the top spelling out the NEAT ≠
  NEAT-AI distinction and linking to the canonical entry in `AGENTS.md`.
- Extended step 2 of the **Where to start** reading path to call out the
  [terminology entries](../AGENTS.md#-terminology) and the
  [NEAT vs NEAT-AI rule](../AGENTS.md#-neat-vs-neat-ai--which-term-to-use) in
  `AGENTS.md`, so newcomers see the distinction early.
- Updated the COMPARISON entry to "how NEAT-AI compares to standard NEAT,
  traditional neural networks, CNNs, RNNs, and modern LLMs".

## Acceptance Criteria

- [x] Opening paragraph of root `README.md` makes the NEAT vs NEAT-AI
      distinction explicit on first use.
- [x] Feature Highlights consistently use **NEAT-AI** when describing the
      project's behaviour (added a framing preamble; the existing entries
      already used NEAT-AI when referring to the project).
- [x] `docs/README.md` references the AGENTS.md terminology entries as part of
      the reading path.
- [x] Internal links and Mermaid diagrams still render (no diagram or link
      targets were touched).
- [x] Markdownlint and `./quality.sh` pass for the doc changes (`deno fmt`,
      `deno lint`, `deno check`, bash check all pass).

## Evidence

This change is purely documentation prose. There is no UI surface and no
performance-affecting code path. The evidence is the diff itself plus the
quality gate output:

- `./quality.sh --lint-only < /dev/null` → all four steps pass (deps update,
  fmt, lint, bash check).
- `./quality.sh < /dev/null` → 6569 tests pass; the 2 failing tests
  (`DiscoveryTimeout.ts: DiscoverDirectory returns partial results on timeout`
  and `Timeout during file reading returns partial data`) are **pre-existing FFI
  dynamic-library leak detector failures** on the
  `milestone/ours-vs-standard-neat` base branch and are unrelated to this
  doc-only change. Verified by stashing my edits and re-running — the same two
  tests still fail on a clean base branch checkout.

## Test Plan

- Existing markdownlint / `deno fmt` checks via `quality.sh` cover prose
  formatting.
- No new code paths were introduced, so no new unit tests are required.
- Reviewed the rendered Markdown locally: the `[!IMPORTANT]` callouts, the
  Mermaid `flowchart LR` block, the docs map, and all internal anchors render
  cleanly.

## Notes

- Issue #2600 (COMPARISON.md rework) is still open. The acceptance criteria for
  #2601 say the docs map blurb for `COMPARISON.md` should reflect its new
  framing "once #2600 lands". This PR makes a minimal, forward-compatible update
  — the blurb now describes COMPARISON as "how NEAT-AI compares to standard NEAT
  and other approaches" — which is consistent with the direction in #2600 and
  does not need to be revisited when #2600 merges.
