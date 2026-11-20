## Summary

PRs #4172 and #4176 delivered the controlled budget-conditioned study and its
negative result. They left one part of #4161 open: "Read and pin the full method
before reproducing it". The full text still cannot be fetched from this host.
This PR pins two more sections of arXiv 2611.06895 from search-indexed excerpts
read on 2026-11-20, and narrows what stays unpinned. The study's code paths and
results are unchanged.

New in `SOURCE_METHOD` (`scripts/lib/budgetConditionedStudy.ts`) and on the
evidence page:

- **Fitness (Section 3.4):** step rewards are averaged per stimulus block,
  blocks to an episode, episodes per age, and ages to the genome fitness.
  Training uses 15 episodes per genome per generation, split equally across the
  training ages. Mapped as `analogue`: the study's fitness is the mean
  calibration MSE over its training budgets.
- **Rewards (Section 3.4):** the optomotor reward rule (positive when facing the
  stimulus direction while moving forward, negative beyond 90°, zero with no
  forward command), the phototaxis luminance reward, and the motor limits ωmax =
  240° and vmax = 30. Mapped as `departs`.
- **Testing (Section 3.6):** testing has no further evolution and uses 11
  equally spaced ages. Weights are regenerated from the testing substrate with
  the evolved CPPN kept. Mapped as `analogue`: the study re-expresses each
  genome at 5 budgets.

Still unpinned, and listed in `SOURCE_METHOD.unpinned`: the rest of Table 3, the
exact reward equations (magnitudes, luminance function, block length), and which
of the 11 test ages are the "three unseen developmental times". The manifest
keeps `fullTextRead: false`, so that part of the issue stays open. Part of
#4161.

## Spec

### Intent and Rationale

- The only part of #4161 still open is pinning the paper's method. Every page
  serving the full text is refused by this host's proxy, so the reachable
  progress is to pin what the new excerpts give and to name precisely what they
  do not.

### Essential Design Decisions

- **Data only:** this PR adds three elements to `SOURCE_METHOD`, rewrites two
  `unpinned` entries and changes no study logic. The regenerated artefact's
  results match the previous one exactly.
- **No guessing:** where an excerpt gives a rule but not its equation, the rule
  is pinned and the equation stays in `unpinned`. The 11-age grid is pinned, but
  which ages count as the "three unseen" is not inferred from it.

### Undiscoverable Facts

- **Paper access (2026-11-20):** curl to arxiv.org (abs, PDF and export) and
  Semantic Scholar gave `CONNECT tunnel failed, response 403`. WebFetch of
  `arxiv.org/html/2611.06895`, the PMC copy (`PMC13781166`) and the Europe PMC
  full-text API gave `proxy refused the connection`. The new details come from
  web-search excerpts of the HTML full text.
- **Scorer:** `./quality.sh` needs the native `rust_scorer`, and this worktree
  has none next to it. It was built from a fresh clone of NEAT-AI-scorer,
  outside the checkout, and passed with `--rust-scorer-bin`.

## Evidence

This is a backend research harness with no UI. Artefact:
`docs/evidence/budget-conditioned-4161.json`, regenerated at code commit
`4e908a10` (NEAT-AI 7.1.28, Deno 2.9.8): 80 of 80 runs, 0 failures. Both
outcomes are still `failure`, and the manifest carries 14 pinned elements with
`fullTextRead: false`.

Reproducibility:

- **Two runs at `4e908a10`:** the JSON was identical after `jq -S` with
  `latencyMicros` and `medianLatencyMicros` deleted.
- **Against the `37dfc1bb` artefact:** identical except latency, `codeVersion`,
  `neatAiVersion` (7.1.22 → 7.1.28) and `manifest.paper`.

```bash
deno task budget-conditioned-study --code-version=4e908a10 \
  --json=docs/evidence/budget-conditioned-4161.json
```

## Acceptance Criteria

- **missing** — "Read and pin the full method before reproducing it" — reason:
  the full text is still refused by the host proxy (arxiv.org, its mirrors, PMC
  and Europe PMC). Sections 3.4 and 3.6 are now pinned from excerpts, but the
  rest of Table 3, the exact reward equations and the identity of the three
  unseen ages remain in `SOURCE_METHOD.unpinned`.

## Test Plan

- No test added or edited. The change is data in `SOURCE_METHOD`, which is
  already covered by these tests in `test/scripts/BudgetConditionedStudy.ts`:
  - `the manifest pins the source method it maps onto`: every element has
    non-empty text and a valid fidelity, and the run's manifest equals
    `SOURCE_METHOD`.
  - `a manifest that did not read the full text names what it could not pin`:
    `fullTextRead` is `false`, `unpinned` is non-empty, and no element is pinned
    twice.
- `deno test -A test/scripts/BudgetConditionedStudy.ts` passed 27 of 27 after
  the edit.
- **Full gate:** `./quality.sh --rust-scorer-bin=<built rust_scorer>` on
  `eef9b457` passed with exit 0: 10,577 passed, 0 failed, 50 ignored. It covered
  fmt, lint, check and all tests.
- **Not checked:** the paper's full text; macOS and Windows.
