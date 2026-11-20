# Experiment: differential-weight offspring and delayed population contraction (Issue #4156) — clean-commit check and fifth paper attempt

## Summary

PRs #4165, #4177, #4181 and #4184 merged the opt-in harness, the 12-arm study,
its negative/mixed result, the recovered preparation costs and four attempts to
read arXiv 2610.26202. This PR changes no code, setting, arm, seed, result or
manifest field. It edits only `docs/evidence/differential-weight-4156.md`:

- § Versions gains a **clean-commit check**. The reported run's `codeVersion` is
  `d85139e6+uncommitted-review-fix`. The study was re-run at clean commit
  `6639854d` (NEAT-AI 7.1.32). Its record-budget phase matched the committed
  manifest on all 360 printed per-run lines, the five calibration MSEs and the
  threshold, and all 11 contrast lines. The equal-wall-clock phase did not
  finish within the 1,500 s timeout on a loaded host, so it is still tied to the
  uncommitted tree.
- § Preparation and search cost: the "one limit remains" paragraph now records
  the transcript audit. Of the 29 agent transcripts on this host that name the
  study, only the 2026-11-13 session and the 2026-11-20 replays ran it.
- § Paper (partly pinned) records a fifth attempt to read the full text. arXiv
  is still refused by the proxy, and two more web searches found no new fact
  about this paper.

Two criteria stay partial: the paper's full method is still unread, and the
later sessions' smoke runs cannot be audited from this host. Part of #4156.

## Spec

### Intent and Rationale

- The open gaps are the unread paper and the run's unclean `codeVersion`. The
  paper is still unreachable. The record-budget phase is deterministic per seed,
  so re-running it at a clean commit tests whether the uncommitted review fix
  changed any reported record-budget result. It did not.

### Essential Design Decisions

- The re-run wrote to a scratch file. The committed manifest was not replaced:
  the wall-clock phase did not finish, and replacing only half of it would mix
  two runs.
- The check is not in the preparation table. It ran after the reported run and
  changed nothing, and the table counts what shaped the reported result. Its
  cost is stated in the paragraph instead, so the `PREPARATION_RUNS` constant
  and the manifest stay byte-identical.
- The other paper by the same author (arXiv 2610.22397, DE/rand/1/bin with
  self-adapted F and CR) is mentioned only to say it pins nothing here. It stays
  out of the pinned and "unverified" lists.

### Undiscoverable Facts

- Clean-commit run:
  `timeout 1500 deno task differential-weight-study --code-version=6639854db73450ce05d78e436d092f69df297285 --json=<scratch file>`.
  It exited 124 after 25 minutes of real time and 6 minutes of user CPU, during
  the equal-wall-clock phase. The record-budget phase and contrasts had printed
  by then.
- Comparison: a scratch script parsed every
  `seed … holdout MSE … records …
  gens …` line and every contrast line. It
  compared them with `docs/evidence/differential-weight-4156.json`: 360 of 360
  per-run lines and 11 of 11 contrasts matched, with 0 mismatches. Calibration
  printed 0.1152, 0.01406, 0.01282, 0.06558 and 0.006303, against a manifest
  threshold of 0.014063…
- Transcript audit: the agent transcripts under the worker's Claude config were
  searched for `Bash` calls that run the study. Hits came only from 2026-11-13
  (the smoke runs, pilot and first full run already in the table) and from the
  2026-11-20 replays.
- On 2026-11-20 at about 07:20 UTC, `curl -m 12` returned status `000` for
  `arxiv.org/abs`, `/pdf`, `export.arxiv.org` and Semantic Scholar. WebFetch to
  `arxiv.org/html/2610.26202v1` returned `proxy refused the connection`.

## Evidence

Docs only; no UI, code or test file changed.

- `docs/evidence/differential-weight-4156.md` § Versions: the "Clean-commit
  check (2026-11-20)" paragraph.
- `docs/evidence/differential-weight-4156.md` § Preparation and search cost: the
  transcript-audit sentences at the end of "One limit remains."
- `docs/evidence/differential-weight-4156.md` § Paper (partly pinned): the
  fifth-attempt sentences in "What was read."
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
  reviewer: partial — reason: the fifth attempt was again refused by the proxy,
  so the delay formula and cap, the DE variant, F/CR, the injection fraction and
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
  `docs/evidence/differential-weight-4156.json`; § Versions "Clean-commit
  check"; § Preparation and search cost — reviewer: partial — reason: the
  record-budget results now reproduce at a clean commit. Smoke runs from the
  2026-11-16-onward sessions still cannot be ruled out, because no transcript
  here holds them. The equal-wall-clock phase is still tied to
  `d85139e6+uncommitted-review-fix`.
- **met** — Provide deterministic positive/negative correctness tests for new
  behaviour and pass the repository's normal quality checks. Research runs are
  separate from routine feature CI — evidence:
  `test/scripts/DifferentialWeightStudy.ts`; `./quality.sh` passed on eb6355dd
  (see Test Plan) — reviewer: met
- **met** — Deliver a reproducible command/manifest and machine-readable results
  with paired distributions, uncertainty, failures and actual coverage —
  evidence: `deno task differential-weight-study` and
  `docs/evidence/differential-weight-4156.json`. The command reproduced every
  printed record-budget value at `6639854d` — reviewer: partial — reason: the
  reviewer flagged that the equal-wall-clock phase was not reproduced at a clean
  commit. That phase runs on a real clock, so by design it is never
  bit-reproducible. The command, manifest, distributions, CIs, failures and
  coverage all exist. The code-version gap is recorded under the criterion
  above.
- **met** — Record negative findings and remove optional code that does not earn
  its maintenance cost. Do not claim success before representative runs —
  evidence: `docs/evidence/differential-weight-4156.md` § Finding, including
  "What code stays." — reviewer: met
- **met** — Keep public implementation and fixtures application-agnostic —
  evidence: synthetic corpus `synthetic-tanh-quadratic-v1` — reviewer: met
- **met** — Leave unassigned until an implementer actively starts — evidence:
  this PR changes no assignment — reviewer: missing — reason: the reviewer said
  it "cannot be checked from the diff" and gave no verdict; this run assigned no
  one.

## Standards Review

<!-- vibe-standards-review inputs="diff+CODING-STANDARDS.md" -->

- **clean** — no `CODING-STANDARDS.md`; reviewed against `AGENTS.md`,
  `docs/ENGINEERING_PRINCIPLES.md` and `docs/DOC_STYLE.md`. Clean areas:
  - The numbers agree with the manifest: 86,345,600 and 1,200,000 records, the
    0.01406 threshold, 360 = 12 × 30 lines, 11 contrasts, the 44156–44185 range
    and NEAT-AI 7.1.32.
  - The `#reproduce` anchor resolves, and the attempts are numbered in order.
  - The text is in Australian English and follows the NEAT vs NEAT-AI rule.
  - No code, test or workflow lines changed, and no rule is marked review-only.
  - Optional points fixed in this diff: CPU and UTC are spelt out on first use,
    and the check now names its validation and calibration seed ranges.
  - Optional points left as they are: the comparison output is not committed,
    and the page keeps growing.

## Test Plan

- No tests were added or changed.
- `./quality.sh --rust-scorer-bin=<rust_scorer built from NEAT-AI-scorer>` on
  eb6355dd exited 0: 10577 passed, 0 failed, 50 ignored (13m6s). The later
  commit changes only this summary.
- `deno fmt --check docs/evidence/differential-weight-4156.md` passed. cspell
  with `docs/cspell.json` found 0 issues in that file.
  `deno test -A --parallel test/docs/*.ts` passed: 318 passed, 0 failed.
- `deno.lock`: a one-off cspell run changed it, and the worker's checkpoint
  commit 69018f2b picked that up. c810e550 restores the base file, so the PR's
  net diff has no lockfile change.
- Tests removed: none. Assertions removed: none.

Not done: the paper's full text is unread, the equal-wall-clock phase was not
re-run to completion at a clean commit, and smoke runs from the later sessions
cannot be audited. Remaining risk: if the full text differs from the excerpts,
the "How the harness maps" list may need revising.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
