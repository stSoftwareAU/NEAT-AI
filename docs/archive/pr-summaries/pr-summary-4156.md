# Experiment: differential-weight offspring and delayed population contraction (Issue #4156) — clean-commit check and fifth paper attempt

## Summary

PRs #4165, #4177, #4181 and #4184 merged the opt-in harness, the 12-arm study,
its negative/mixed result, the recovered preparation costs and four attempts to
read arXiv 2610.26202. This PR changes no code, setting, arm, seed or criterion.
It edits `docs/evidence/differential-weight-4156.md` and adds one generated
artefact, `docs/evidence/differential-weight-4156-clean-6639854d.json`:

- § Versions: **clean-commit checks**. The reported run's `codeVersion` is
  `d85139e6+uncommitted-review-fix`. The study was re-run twice at clean commit
  `6639854d` (NEAT-AI 7.1.32). The first run timed out in the equal-wall-clock
  phase on a loaded host. The second finished and wrote the new JSON. Its
  record-budget phase is identical to the committed manifest: 360 of 360 results
  apart from `wallMs`, 12 of 12 coverage rows, and the 11 contrasts apart from
  `wallClockMedianRatio`. In `manifest`, only `codeVersion` and `neatAiVersion`
  differ. Its equal-wall-clock phase, on the same seeds, replicated neither the
  reported harm contrast (`contraction@reenter`) nor the `lpsr@reenter` lean. No
  contrast is harm or benefit there, and two are `insufficient-data`.
- The Finding and § Equal wall-clock now say the wall-clock harm result did not
  replicate at the clean commit.
- § Preparation and search cost counts both checks: 187,642,400 records for the
  finished one, and 87,545,600 plus an unrecorded part of the wall-clock phase
  for the timed-out one. It also records the transcript audit.
- § Paper (partly pinned) records a fifth and a sixth attempt to read the full
  text. Both were refused by the proxy. The new section 3.3 excerpts (δ = 0.76
  at a budget of 1,200 evaluations, with 20 members) are listed as unverified.

Two criteria stay partial: the paper's full method is still unread, and the
later sessions' smoke runs cannot be audited from this host. Part of #4156.

## Spec

### Intent and Rationale

- The open gaps are the unread paper and the run's unclean `codeVersion`. The
  paper is still unreachable. Re-running the whole study at a clean commit tests
  whether the uncommitted review fix changed any reported result. The
  record-budget phase is deterministic per seed and is identical. The wall-clock
  phase runs on a real clock, so it can only be compared in outcome, and its
  single harm verdict did not hold.

### Essential Design Decisions

- The committed manifest stays the reported run. The clean run is committed
  beside it as a separate artefact, not merged into it, so that no file mixes
  two runs. Making the clean run the reported one would also need the harness's
  `PREPARATION_RUNS` constant changed, which this docs-only change avoids.
- The checks are not in the preparation table, because they ran after the
  reported run and shaped nothing. Their costs are counted in the paragraph
  under the table instead.
- The other paper by the same author (arXiv 2610.22397) is mentioned only to say
  it pins nothing here.

### Undiscoverable Facts

- Finished clean run, started at about 08:10 UTC and ending at 08:17 UTC on
  2026-11-20 (load average about 1), in a detached worktree at `6639854d`:
  `timeout 2700 deno task differential-weight-study --code-version=6639854db73450ce05d78e436d092f69df297285 --json=<scratch>`,
  exit 0. `git diff 6639854d HEAD -- scripts src test deno.json wasm_activation`
  is empty, so the branch head runs the same code.
- Comparison: a scratch script compared the two JSON files key by key, ignoring
  `wallMs` and `wallClockMedianRatio`. The record-budget contrasts differ only
  by the clean code's added `diversitySeeds` and `speciesSeeds` fields, both 30.
- The censored run was `de+lpsr@reenter` at seed 44166, which had no scored
  creature after 1,311 ms. Seed 44183 of `de@isolated` and
  `contraction@isolated` ran one generation (842 ms and 723 ms) with no
  diversity measurement, so those contrasts read `insufficient-data`.
- Earlier timed-out run: `timeout 1500 …` exited 124 after 25 minutes of real
  time and 6 minutes of user CPU.
- Sixth paper attempt, at about 08:10 UTC: WebFetch to
  `arxiv.org/pdf/2610.26202v1` returned `proxy refused the connection`, and
  `curl` to OpenAlex, the Semantic Scholar API, alphaXiv and a reader proxy
  returned status `000`.

## Evidence

Docs and a generated artefact only. No UI, code or test file changed.

- `docs/evidence/differential-weight-4156.md` § Versions: the "Clean-commit
  checks (2026-11-20)" paragraphs.
- `docs/evidence/differential-weight-4156-clean-6639854d.json`: the clean run's
  manifest, results, coverage and contrasts for both phases.
- `docs/evidence/differential-weight-4156.md` Finding, § Equal wall-clock and §
  Preparation and search cost: the replication note and the checks' costs.
- `docs/evidence/differential-weight-4156.md` § Paper (partly pinned): the fifth
  and sixth attempts and the new unverified section 3.3 excerpts.
- Sources of the search facts: WebSearch results on 2026-11-20 for arXiv
  2610.26202 (<https://arxiv.org/abs/2610.26202>,
  <https://arxiv.org/pdf/2610.26202>), read only as search excerpts.

Issue numbers cited: #4156 (this issue: Experiment: Test differential weight
offspring and delayed population contraction); #4165, #4177, #4181 and #4184
(the merged PRs for this issue).

## Acceptance Criteria

<!-- vibe-spec-review inputs="diff+issue-body" -->

- **partial** — Read and pin the full method before reproducing it — evidence:
  `docs/evidence/differential-weight-4156.md` § Paper (partly pinned) —
  reviewer: partial — reason: the fifth and sixth attempts were refused by the
  proxy, so the delay formula and cap, the DE variant, F/CR, the injection
  fraction and the Solis–Wets parameters are still not pinned. The new δ = 0.76
  excerpt is listed as unverified.
- **met** — First inspect current code, merged work and repository instructions.
  Reuse existing mechanisms — evidence: the adaptive arms reuse
  `computeAdaptivePopulationSize` (`src/NEAT/AdaptivePopulationSizer.ts`) and
  `detectPlateau` (`src/NEAT/PlateauDetector.ts`) in
  `scripts/lib/differentialWeightStudy.ts` (merged in earlier PRs; not
  re-reviewed in this run)
- **met** — Opt-in experiment only; preserve ordinary behaviour, interfaces,
  immutable parents and full authoritative acceptance. No automatic deployment
  or default change — evidence: the harness lives under `scripts/`, nothing
  under `src/` imports it, and this PR changes only docs and adds one JSON
  artefact (not re-reviewed in this run)
- **partial** — Predeclare controls, seeds, sample size, compute limits and
  success/failure criteria. Identify code/model/data versions; separate
  calibration from untouched validation and count all preparation/search costs —
  evidence: `settings`, `criteria`, `validationSeeds` and `preparation` in
  `docs/evidence/differential-weight-4156.json`;
  `docs/evidence/differential-weight-4156-clean-6639854d.json`; § Versions
  "Clean-commit checks"; § Preparation and search cost — reviewer: partial —
  reason: the record-budget phase is identical at clean commit `6639854d`, and
  both checks' costs are counted. Two gaps remain: smoke runs from the
  2026-11-16-onward sessions cannot be audited, and the reported wall-clock
  phase is still tied to `d85139e6+uncommitted-review-fix`. Its clean re-run did
  not reproduce the reported result.
- **met** — Provide deterministic positive/negative correctness tests for new
  behaviour and pass the repository's normal quality checks. Research runs are
  separate from routine feature CI — evidence:
  `test/scripts/DifferentialWeightStudy.ts` and `./quality.sh` on eb6355dd (see
  Test Plan; not re-reviewed in this run)
- **met** — Deliver a reproducible command/manifest and machine-readable results
  with paired distributions, uncertainty, failures and actual coverage —
  evidence: `deno task differential-weight-study`,
  `docs/evidence/differential-weight-4156.json`, and the clean run's JSON, which
  reproduces every record-budget result field for field (not re-reviewed in this
  run)
- **met** — Record negative findings and remove optional code that does not earn
  its maintenance cost. Do not claim success before representative runs —
  evidence: `docs/evidence/differential-weight-4156.md` Finding and § Finding,
  including "What code stays". The Finding now says the wall-clock harm result
  did not replicate (not re-reviewed in this run)
- **met** — Keep public implementation and fixtures application-agnostic —
  evidence: synthetic corpus `synthetic-tanh-quadratic-v1` (not re-reviewed in
  this run)
- **met** — Leave unassigned until an implementer actively starts — evidence:
  this PR changes no assignment (not re-reviewed in this run)
- **unrequested** — none — reviewer: the reviewer found no change in the diff
  that cannot be traced to the issue.

## Standards Review

<!-- vibe-standards-review inputs="diff+CODING-STANDARDS.md" -->

- **violation** — DOC_STYLE rule 1: UTC was not spelt out on its new first use —
  evidence: `docs/evidence/differential-weight-4156.md` § Versions — reason:
  fixed in this diff (the expansion moved to the first use)
- **violation** (optional) — undefined `FE_max`, "similar budget" for a factor
  of two, "uncommitted tree (the committed manifest)", and a headline that did
  not mention the non-replication — evidence:
  `docs/evidence/differential-weight-4156.md` § Paper, § Versions, Finding —
  reason: fixed in this diff
- **clean** — no `CODING-STANDARDS.md`; reviewed against `AGENTS.md`,
  `docs/ENGINEERING_PRINCIPLES.md` and `docs/DOC_STYLE.md`. Australian English
  and the NEAT vs NEAT-AI rule are followed. The `#versions`,
  `#preparation-and-search-cost`, `#equal-wall-clock` and `#reproduce` anchors
  resolve. Records totals, medians, the censored run, the verdict counts and the
  contrast values agree with the new JSON. No statement contradicts another. No
  file under `src/`, `test/`, `scripts/`, `bench/`, `mod.ts` or `deno.json`
  changed. The JSON is valid, formatted, and has no local paths.

## Test Plan

- No tests were added or changed.
- `./quality.sh --rust-scorer-bin=<rust_scorer built from NEAT-AI-scorer>` on
  eb6355dd exited 0: 10577 passed, 0 failed, 50 ignored (13m6s). Later commits
  change only docs and add one JSON artefact. The worker re-runs the quality
  gate.
- `deno fmt` on both changed evidence files passed. cspell with
  `docs/cspell.json` found 0 issues in the evidence page.
  `deno test -A --parallel test/docs/*.ts` passed: 318 passed, 0 failed.
- `deno.lock`: the cspell run's change was reverted, so the PR's net diff has no
  lockfile change.
- Tests removed: none. Assertions removed: none.

Not done: the paper's full text is unread, and smoke runs from the later
sessions cannot be audited. Remaining risk: if the full text differs from the
excerpts, the "How the harness maps" list may need revising.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
