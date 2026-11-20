# Experiment: differential-weight offspring and delayed population contraction (Issue #4156) — paper retry

## Summary

PRs #4165 and #4177 merged the opt-in harness, the 12-arm study and its
negative/mixed result. The one criterion they left open is "Read and pin the
full method before reproducing it", because arXiv 2610.26202 cannot be fetched
from the container. This PR records a third attempt (2026-11-20). arxiv.org is
still refused, and a GitHub code search finds only the two secondary sources
already on record. The evidence page gains a separate list of facts the
search-engine excerpts reported that day, kept apart from the pinned facts:

- section 3.1's title;
- MERLIN's method-table entry, "CMA-ES + DE injection (+ Solis–Wets)", and the
  excerpt that removing its Solis–Wets step does not hurt it;
- in the paper's Grasshopper runs, the L-SHADE variants used a constant
  population.

No setting, arm, seed, result or manifest changes. The delay formula and cap,
the DE variant, F and CR, the injection fraction and the Solis–Wets parameters
are still not pinned, so the criterion stays partial. Part of #4156.

## Spec

### Intent and Rationale

- The only open implementation criterion is reading the paper's full method.
  Every route to the full text was retried; only search excerpts answered, so
  this PR records what they added rather than changing the study.

### Essential Design Decisions

- The 2026-11-20 facts are listed under their own "Reported in search excerpts,
  unverified" heading, not under **Pinned.**, and are deliberately not added to
  the manifest's `paper.pinned` list. Adding them there would mean regenerating
  the whole artefact (a multi-hour 12-arm study re-run) for unverified text.
- The committed manifest is unchanged; the page says it predates this attempt.

### Undiscoverable Facts

- Fetches on 2026-11-20: `curl` to arxiv.org (abs, pdf), export.arxiv.org,
  Semantic Scholar, alphaXiv and a reader proxy all failed;
  `curl https://arxiv.org/abs/2610.26202` printed
  `curl: (56) CONNECT tunnel failed, response 403` while github.com answered.
  WebFetch to `arxiv.org/html/2610.26202` returned
  `proxy refused the connection`.
- `gh search code "2610.26202"` returned only `vip3001003/nofx-papers` (two
  abstract copies), `Lee2817794840/feishu-wenxian` (the reading note already
  cited) and this repository's own files.

## Evidence

Documentation only; no UI, script or test files changed.

- `docs/evidence/differential-weight-4156.md` § Paper (partly pinned): the "What
  was read." paragraph records the 2026-11-20 attempt, and the new "Reported in
  search excerpts, unverified (2026-11-20)" list sits between **Pinned.** and
  **Not pinned.**
- Sources of the new facts: WebSearch results for arXiv 2610.26202 on 2026-11-20
  (<https://arxiv.org/abs/2610.26202>, <https://arxiv.org/pdf/2610.26202>), read
  only as search excerpts.

Issue numbers cited: #4156 (this issue: Experiment: Test differential weight
offspring and delayed population contraction); #4165 and #4177 (the merged PRs
that delivered the harness and the study).

## Acceptance Criteria

<!-- vibe-spec-review inputs="diff+issue-body" -->

- **partial** — Read and pin the full method before reproducing it — evidence:
  `docs/evidence/differential-weight-4156.md` § Paper (partly pinned) —
  reviewer: partial — reason: arxiv.org was refused again on 2026-11-20, so the
  full text is unread; the delay formula and cap, DE variant, F/CR, injection
  fraction and Solis–Wets parameters are still not pinned.
- **met** — First inspect current code, merged work and repository instructions.
  Reuse existing mechanisms — evidence: the adaptive arms reuse
  `computeAdaptivePopulationSize` in `scripts/lib/differentialWeightStudy.ts`
  (merged in #4165/#4177) — reviewer: met
- **met** — Opt-in experiment only; preserve ordinary behaviour, interfaces,
  immutable parents and full authoritative acceptance. No automatic deployment
  or default change — evidence: the harness lives under `scripts/` and nothing
  in `src/` imports it; this PR changes one doc — reviewer: met
- **partial** — Predeclare controls, seeds, sample size, compute limits and
  success/failure criteria. Identify code/model/data versions; separate
  calibration from untouched validation and count all preparation/search costs —
  evidence: the manifest's `settings`, `criteria`, `validationSeeds` and
  `preparation` in `docs/evidence/differential-weight-4156.json` — reviewer:
  partial — reason: the pilot's and first full run's seeds and records were
  never written down, so their costs stay bounds, not measurements; they cannot
  be recovered.
- **met** — Provide deterministic positive/negative correctness tests for new
  behaviour and pass the repository's normal quality checks. Research runs are
  separate from routine feature CI — evidence:
  `test/scripts/DifferentialWeightStudy.ts`; `./quality.sh` passed on this head
  (see Test Plan) — reviewer: met
- **met** — Deliver a reproducible command/manifest and machine-readable results
  with paired distributions, uncertainty, failures and actual coverage —
  evidence: `deno task differential-weight-study` and
  `docs/evidence/differential-weight-4156.json` — reviewer: met — reason: the
  reviewer noted the manifest's `paper.pinned` now lags the page; the page now
  says the new facts are deliberately not in that list.
- **met** — Record negative findings and remove optional code that does not earn
  its maintenance cost. Do not claim success before representative runs —
  evidence: the evidence page's mixed/negative result; no success claimed —
  reviewer: met
- **met** — Keep public implementation and fixtures application-agnostic —
  evidence: synthetic corpus `synthetic-tanh-quadratic-v1` — reviewer: met
- **met** — Leave unassigned until an implementer actively starts — evidence: no
  assignment change in this PR — reviewer: missing — reason: the reviewer called
  it "n/a — a process step the diff cannot show"; this run assigned no one.

## Standards Review

<!-- vibe-standards-review inputs="diff+CODING-STANDARDS.md" -->

- **violation** — DOC_STYLE rule 4 (claims checked against the reference they
  cite): the "MERLIN without its Solis–Wets step" excerpt read as contradicting
  the page, which never said MERLIN has that step — evidence:
  `docs/evidence/differential-weight-4156.md:419` — reason: fixed in this diff;
  the bullet now quotes the method-table entry "CMA-ES + DE injection (+
  Solis–Wets)".
- **violation** — DOC_STYLE rules 4 and 8: unverified excerpts were listed under
  **Pinned.**, so the page disagreed with the manifest's `paper.pinned` —
  evidence: `docs/evidence/differential-weight-4156.md:416` — reason: fixed in
  this diff; they moved to a separate "unverified" list that says they are not
  in the manifest.
- **violation** — DOC_STYLE rule 4: the inference that the Grasshopper runs "say
  nothing about this arm" went past its source — evidence:
  `docs/evidence/differential-weight-4156.md:431` — reason: fixed in this diff;
  the inference is removed, and the page says which problems the 40-of-51
  comparisons cover is not pinned.
- **clean** — the repo has no `CODING-STANDARDS.md`, so the review used
  `AGENTS.md`, `docs/ENGINEERING_PRINCIPLES.md` and `docs/DOC_STYLE.md`
  (review-enforced documentation-audit rules): manifest consistency
  (`methodRead: "partial"`), Australian English, terms glossed on first use, no
  NEAT vs NEAT-AI wording; no code changed, so the testing, logging, UUID and
  semantic-version invariants do not apply.

## Test Plan

- No tests added or changed; the diff is one Markdown file.
- `deno fmt --check docs/evidence/differential-weight-4156.md` and cspell
  (`docs/cspell.json`) on the final edit: clean.
- `./quality.sh --rust-scorer-bin=<rust_scorer built from a fresh NEAT-AI-scorer clone>`
  on c25c7638: exit 0, 10577 passed, 0 failed, 50 ignored (11m5s).
- Tests removed: none. Assertions removed: none.

Not done: the paper's full text was not read and the 2026-11-20 excerpts are
unchecked against it, because the container proxy refuses arXiv. The pilot's
preparation cost remains a bound. Remaining risk: if the full text differs from
the excerpts, the mapping and the "Pinned." list may need revising.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
