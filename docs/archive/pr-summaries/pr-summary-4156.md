# Experiment: differential-weight offspring and delayed population contraction (Issue #4156) — fourth paper attempt

## Summary

PRs #4165, #4177 and #4181 merged the opt-in harness, the 12-arm study, its
negative/mixed result and three attempts to read arXiv 2610.26202. This PR
changes documentation only, in `docs/evidence/differential-weight-4156.md`:

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
seed, result or manifest changes. The full method still is not read, and the
pilot's preparation records cannot be recovered, so two criteria stay partial.
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

Documentation only. No UI, script or test file changed.

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
  reviewer: partial — reason: no route from this host reaches the full text, so
  the delay formula and cap, the DE variant, F/CR, the injection fraction and
  the Solis–Wets parameters are still not pinned.
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
  `docs/evidence/differential-weight-4156.json` — reviewer: met — reason: the
  pilot's and first full run's seeds and records were never written down, so
  their costs are bounds, not measurements. "Count all" is therefore not fully
  met, and those records cannot be recovered.
- **met** — Provide deterministic positive/negative correctness tests for new
  behaviour and pass the repository's normal quality checks. Research runs are
  separate from routine feature CI — evidence:
  `test/scripts/DifferentialWeightStudy.ts`; `./quality.sh` passed on this head
  (see Test Plan) — reviewer: met
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

- **clean** — the repository has no `CODING-STANDARDS.md`, so the review used
  `AGENTS.md`, `docs/ENGINEERING_PRINCIPLES.md` and `docs/DOC_STYLE.md`. None of
  them marks a rule as enforced by review only. Checked and compliant: acronyms
  defined on first use (DOC_STYLE rule 1), themed terms (rule 2), NEAT vs
  NEAT-AI wording (rule 3), claims kept under the unverified heading (rule 4),
  one source of truth with the manifest (rule 8), Australian English, and valid
  `docs/cspell.json`. Code, testing, UUID and WASM rules do not apply.

## Test Plan

- No tests were added or changed. The diff touches two docs files.
- `deno fmt --check docs/evidence/differential-weight-4156.md` passed, and
  cspell with `docs/cspell.json` on that file found 0 issues.
  `deno test -A --parallel test/docs/*.ts` passed: 318 passed, 0 failed.
- `./quality.sh --rust-scorer-bin=<rust_scorer built from NEAT-AI-scorer>` on
  head 11588454 exited 0: 10577 passed, 0 failed, 50 ignored (12m17s).
- Tests removed: none. Assertions removed: none.

Not done: the paper's full text is unread, and the excerpt facts are unchecked
against it. The pilot's preparation cost is still a bound. Remaining risk: if
the full text differs from the excerpts, the "How the harness maps" list may
need revising.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
