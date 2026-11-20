# Experiment: differential-weight offspring and delayed population contraction (Issue #4156) — fourth paper attempt

## Summary

PRs #4165, #4177 and #4181 merged the opt-in harness, the 12-arm study, its
negative/mixed result and three attempts to read arXiv 2610.26202. This PR
changes no behaviour. It edits the evidence page, the manifest's `preparation`
block and the `PREPARATION_RUNS` constant that writes it:

- § Preparation and search cost now counts the pilot and the first full run
  exactly, in place of bounds. Their commands were recovered from the 2026-11-13
  session transcript on this host, and each was replayed at its own code version
  (`34045199`, `52a59186`, and `34045199` with the two contraction-threshold
  lines removed for the pilot). The transcript also showed three smoke runs and
  a probe, which are now counted as well. The six recovered rows charged
  83,435,540 records, so the total before the reported run is 545,148,340.

- § Paper (partly pinned) records a fourth attempt to read the full text. arXiv
  and every mirror tried were still unreachable. GitHub code search found no
  full-text copy, and the author's GitHub repositories hold no MERLIN, RAPTOR or
  L-SHADE-SW source.
- Three more search-excerpt facts are added to the separate "unverified" list:
  the title of section 3.3, how RAPTOR injects DE offspring, and the paper's
  future-work remark that MERLIN's injection fraction should fall with the
  dimension.
- § Finding now says which code stays and why. No product code ships. The
  harness under `scripts/` and its tests stay, because they are the command that
  regenerates the committed manifest.

`docs/cspell.json` gains the two names the page now quotes. No setting, arm,
seed or result changes. In the manifest only `preparation` changes. Two criteria
stay partial: the full method is still unread, and study commands from the
sessions after 2026-11-13 cannot be audited from this host.

Part of #4156.

## Spec

### Intent and Rationale

- The open criterion is "Read and pin the full method before reproducing it".
  This run tried every route this host allows, including the author's own code.
  None of them gave the full text, so the PR records what was tried and found
  rather than changing the study.
- The Spec reviewer rated "remove optional code that does not earn its
  maintenance cost" partial because nothing said why the harness is kept, so the
  page now says it.

### Essential Design Decisions

- Assumption: the harness is not "optional code" under that criterion. It is the
  "reproducible command/manifest" that another criterion requires, and nothing
  under `src/` or in `mod.ts` imports it.
- The new excerpt facts stay under "Reported in search excerpts, unverified" and
  out of the manifest's `paper.pinned`. Adding them there would mean re-running
  the whole 12-arm study for unverified text.

### Undiscoverable Facts

- The 2026-11-13 session transcript (agent session `f9e7bdc5…` in the worker's
  Claude config and its executor subagent `agent-a5f4525b3f8c51b01`) holds every
  study command that session ran, with its printed output. Each replay matched
  every value printed apart from wall-clock times: for example, 28 of 28 per-run
  lines for the first full run, and the probe's `control@reenter 529 474 89`.
  The first full run charged 1,198,800 calibration records, not the 1,200,000
  assumed before. No transcript on this host holds study commands from
  2026-11-16 on.
- arXiv and its mirrors still returned HTTP `000` on 2026-11-20 at about 06:40
  UTC (`arxiv.org/abs`, `/pdf`, `/html`, `export.arxiv.org`, ar5iv, Semantic
  Scholar's API, alphaXiv, Hugging Face, a reader proxy, `web.archive.org`).
- `curl -m 12` returned HTTP status `000` from each of these: `arxiv.org/abs`,
  `export.arxiv.org`, the Hugging Face papers page and API, alphaXiv,
  `scholar.archive.org`, a reader proxy, and the author's solver and portfolio
  sites. `raw.githubusercontent.com` returned 200. WebFetch to
  `arxiv.org/html/2610.26202v1` returned `proxy refused the connection`.
- `gh api search/code` for the title, `"2610.26202"`, `"budget-aware delay"` and
  `"small evaluation and wall-clock budgets"` found only
  `vip3001003/nofx-papers`, `Lee2817794840/feishu-wenxian` (both already cited)
  and this repository. `gh api search/users -f q='Luciano Ambrosini'` returned
  `lucianoambrosini`. Recursive tree listings of its `Ambrosinus-Toolkit`,
  `AmbrosinusDEV`, `Computational-Design-Manifesto` and `lucianoambrosini`
  repositories had no path matching merlin, raptor, shade or solis. A code
  search of the account for RAPTOR, Solis and `2610.26202` returned 0 hits.
- The third-party GitHub mirrors of arXiv cs.AI and cs.LG full texts that held
  another paper (#4163) were checked too. None of their 2026-10-19 to 2026-10-22
  date folders has a folder for this paper.

## Evidence

No UI or test file changed. `scripts/differential_weight_study.ts` changes only
the `PREPARATION_RUNS` strings, its doc comment and `earlierRunSeedNote`.
`scripts/lib/differentialWeightStudy.ts` changes one doc comment.

- `docs/evidence/differential-weight-4156.md` § Preparation and search cost: the
  replay paragraph, six new table rows, and the totals and limits paragraphs.
- `docs/evidence/differential-weight-4156.json` `manifest.preparation`: `note`,
  `runs` and `earlierRunSeedNote`, the same text as the CLI constant.

- `docs/evidence/differential-weight-4156.md` § Paper (partly pinned): the
  fourth-attempt sentences in "What was read." and the three new bullets under
  "Reported in search excerpts, unverified (2026-11-20)".
- `docs/evidence/differential-weight-4156.md` § Finding: the "What code stays."
  bullet.
- Source of the new excerpt facts: WebSearch results for arXiv 2610.26202 on
  2026-11-20 (<https://arxiv.org/abs/2610.26202>,
  <https://arxiv.org/pdf/2610.26202>), read only as search excerpts.

Issue numbers cited: #4156 (this issue: Experiment: Test differential weight
offspring and delayed population contraction); #4165, #4177 and #4181 (the
merged PRs for this issue); #4163 (Experiment: Measure offspring admission
versus durable lineage contribution, whose paper the mirrors did hold).

## Acceptance Criteria

<!-- vibe-spec-review inputs="diff+issue-body" -->

- **partial** — Read and pin the full method before reproducing it — evidence:
  `docs/evidence/differential-weight-4156.md` § Paper (partly pinned) —
  reviewer: partial — reason: no route from this host reaches the full text
  (rechecked on 2026-11-20, every route still HTTP `000`), so the delay formula
  and cap, the DE variant, F/CR, the injection fraction and the Solis–Wets
  parameters are still not pinned.
- **met** — First inspect current code, merged work and repository instructions.
  Reuse existing mechanisms — evidence: the adaptive arms reuse
  `computeAdaptivePopulationSize` (`src/NEAT/AdaptivePopulationSizer.ts`) and
  `detectPlateau` (`src/NEAT/PlateauDetector.ts`) in
  `scripts/lib/differentialWeightStudy.ts` — reviewer: met
- **met** — Opt-in experiment only; preserve ordinary behaviour, interfaces,
  immutable parents and full authoritative acceptance. No automatic deployment
  or default change — evidence: the harness lives under `scripts/`, nothing
  under `src/` imports it, and this PR changes only docs — reviewer: met
- **partial** — Predeclare controls, seeds, sample size, compute limits and
  success/failure criteria. Identify code/model/data versions; separate
  calibration from untouched validation and count all preparation/search costs —
  evidence: `settings`, `criteria`, `validationSeeds` and `preparation` in
  `docs/evidence/differential-weight-4156.json`; § Preparation and search cost —
  reviewer: partial — reason: the pilot and first full run are now counted
  exactly. But smoke runs from the 2026-11-16-onward sessions cannot be audited,
  and the reported run's `codeVersion` is `d85139e6+uncommitted-review-fix`, not
  a clean commit.
- **met** — Provide deterministic positive/negative correctness tests for new
  behaviour and pass the repository's normal quality checks. Research runs are
  separate from routine feature CI — evidence:
  `test/scripts/DifferentialWeightStudy.ts`; `./quality.sh` passed on 11588454,
  and the worker re-runs it on this head (see Test Plan) — reviewer: met
- **met** — Deliver a reproducible command/manifest and machine-readable results
  with paired distributions, uncertainty, failures and actual coverage —
  evidence: `deno task differential-weight-study` and
  `docs/evidence/differential-weight-4156.json` — reviewer: met
- **met** — Record negative findings and remove optional code that does not earn
  its maintenance cost. Do not claim success before representative runs —
  evidence: `docs/evidence/differential-weight-4156.md` § Finding, including
  "What code stays." — reviewer: partial — reason: the reviewer saw no decision
  on whether the harness earns its cost. That bullet now records it: no product
  code ships, and the harness is kept as the required reproducible command.
- **met** — Keep public implementation and fixtures application-agnostic —
  evidence: synthetic corpus `synthetic-tanh-quadratic-v1` — reviewer: met
- **met** — Leave unassigned until an implementer actively starts — evidence:
  this PR changes no assignment — reviewer: missing — reason: the reviewer said
  it is "not checkable from the diff", since it concerns handling of the issue;
  this run assigned no one.

## Standards Review

<!-- vibe-standards-review inputs="diff+CODING-STANDARDS.md" -->

- **violation** — DOC_STYLE rule 4, claims match the evidence: "each run
  exactly" and "every run in the table is counted exactly" overstated the result
  — evidence: `docs/evidence/differential-weight-4156.md` § Preparation and
  search cost — reason: fixed in this diff; both now point to the stated limit.
- **violation** — single source of truth: the seed notes left out the probe's
  seed 5 — evidence: `scripts/differential_weight_study.ts`
  `earlierRunSeedNote`, `scripts/lib/differentialWeightStudy.ts`
  `USED_SEED_RANGES` comment — reason: fixed in this diff; the notes name seed 5
  as outside every validation range.
- **violation** — DOC_STYLE rule 4, every claim needs a reference: the session
  transcript behind the replayed figures is not committed or linked — evidence:
  `docs/evidence/differential-weight-4156.md` § Preparation and search cost —
  reason: not fixed. The transcript is private worker state, and the page now
  says so. The replay commands and code versions are given, so the figures can
  be reproduced.
- **clean** — no `CODING-STANDARDS.md`; reviewed against `AGENTS.md`,
  `docs/ENGINEERING_PRINCIPLES.md` and `docs/DOC_STYLE.md`. `PREPARATION_RUNS`
  matches the committed manifest byte for byte, all sums are correct, the text
  is in Australian English, no new acronyms, no logging or test changes, and no
  UUID, `semanticVersion`, WASM or wire-format impact.

## Test Plan

- No tests were added or changed. The replay is the evidence for the new
  figures, and it rests on the existing test
  `runArm is deterministic per seed and restores the caller's generator`.
- `deno test -A --parallel test/scripts/DifferentialWeightStudy.ts test/docs/*.ts`
  on 7be4d7c7: 354 passed, 0 failed. `deno lint`, `deno check` and `deno fmt` on
  the changed scripts were clean, and cspell found 0 issues in the page and the
  CLI.
- `deno fmt --check docs/evidence/differential-weight-4156.md` passed, and
  cspell with `docs/cspell.json` on that file found 0 issues.
  `deno test -A --parallel test/docs/*.ts` passed: 318 passed, 0 failed.
- `./quality.sh --rust-scorer-bin=<rust_scorer built from NEAT-AI-scorer>` on
  head 11588454 exited 0: 10577 passed, 0 failed, 50 ignored (12m17s). It has
  not been run on 7be4d7c7 in this session; the worker re-runs it.
- Tests removed: none. Assertions removed: none.

Not done: the paper's full text is unread, and the excerpt facts are unchecked
against it. Smoke runs from the later sessions cannot be audited. Remaining
risk: if the full text differs from the excerpts, the "How the harness maps"
list may need revising.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
