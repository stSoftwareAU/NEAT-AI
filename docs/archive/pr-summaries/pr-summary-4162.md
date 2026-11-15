## Summary

Adds an opt-in research harness, `deno task topology-weight-luck-study`, that
tests whether a new edge's gain comes from its topology or from where its
initial weight landed. Each of 99 evolved parents gets one new forward edge
under eight fixed weight draws. Each draw is paired with a weight-only nudge of
the same Float32 budget. Three preregistered selection rules pick mutations on a
cheap sample, and the picks are then checked on the full train set and an
untouched holdout.

Result on the synthetic corpus:

- Picking the best of eight draws (`best-draw`) selects weight-placement luck:
  the mutations it picks have a mean holdout gain of −0.00016.
- The preregistered primary test, `median-paired` against `best-draw`, is
  **no-benefit**: +0.175 holdout precision, 95% CI [−0.009, 0.381].
- No default changed, and nothing in `src/` calls the harness.

The paper's method could not be pinned (the arXiv fetch was refused), so this PR
is Part of #4162.

## Spec

### Intent and Rationale

- An added edge is two changes at once: a new topology and a random new weight.
  Pairing each new-edge draw with a weight-only nudge of the same Float32 L1
  budget (|w_k|) separates the two. The paired difference is the topology's
  share of the gain.
- The harness reuses existing code rather than building new machinery:
  - from the #4160 study: the corpus (`buildStudyCorpus`), the starting
    creatures (`buildControlCreature`) and the seeding (now the exported
    `withSeededGlobals`);
  - from the pre-selection A/B harness: the scorer and breeder (`scoreCreature`,
    `breedOffspring`);
  - from production: the weight draw (`Synapse.randomWeight` at the default
    `structuralWeightScale` of 1) and the mutation operators (`Mutator`).

### Essential Design Decisions

- **Assumption — the structural mutation:** each parent gets one new forward
  synapse, chosen uniformly the way AddConnection chooses one. AddNeuron is not
  studied.
- **Assumption — the parents:** the "100 representative parents" are the top 10
  distinct creatures from each of 10 seeded 15-generation runs. All weights and
  biases are rounded to Float32 so the matched budget is exact. Only 99 are
  distinct, and the artefact's `coverage` reports that.
- **Calibration and validation:** selection reads only the cheap sample (the
  first 50 train records). The full train set confirms, and the holdout is never
  read before confirmation. A test proves selection does not change when the
  holdout changes.
- **The criteria:** rules, thresholds (6 of 8), seeds and the
  benefit/harm/no-benefit criteria are fixed in code and in the manifest. The
  primary verdict uses the preregistered CI rule even though the point estimate
  favours `median-paired`.

### Undiscoverable Facts

- `https://arxiv.org/abs/2611.01213` could not be read in this run: the fetch
  failed with `proxy refused the connection`. The method is this repository's
  reading of the issue.
- "Scorer #588" perturbation machinery is not in this repository
  (`gh issue view 588` here is an unrelated release PR), so the perturbations
  are built from `Synapse.randomWeight` and `Math.fround`.
- The study takes about 5 s on this host, so the full 100-parent design ran in
  one go.

## Evidence

Backend/CLI research harness only. No UI files changed.

- Command:
  `deno task topology-weight-luck-study --json=docs/evidence/topology-weight-luck-4162.json --code-version=4ccb7100`
  (base commit 4ccb7100, NEAT-AI 7.1.20, Deno 2.9.8). Coverage: 99 of 100
  parents, 99 mutations, 0 failures.
- Results:
  [docs/evidence/topology-weight-luck-4162.md](../../evidence/topology-weight-luck-4162.md),
  with the machine-readable artefact
  `docs/evidence/topology-weight-luck-4162.json`.

| rule          | selected | holdout precision | mean holdout gain | cheap cost (records) |
| ------------- | -------- | ----------------- | ----------------- | -------------------- |
| single-draw   | 60       | 0.783             | +0.00163          | 9,900                |
| best-draw     | 19       | 0.789             | −0.00016          | 79,200               |
| median-paired | 28       | 0.964             | +0.00291          | 79,200               |

- **Primary** (median-paired − best-draw): +0.175, CI [−0.0088, 0.381] →
  no-benefit.
- **Secondary** (median-paired − single-draw): +0.181, CI [0.079, 0.291] →
  benefit, at eight times the cheap evaluation cost.
- **Holdout distribution:** the median of the per-mutation median paired gain is
  +0.00052 (CI [0.00021, 0.00076]). Only 36% of mutations win at least 6 of 8
  draws, and 8% are luck-only (best draw wins, median does not).
- **Total cost (records):** preparation 533,100; cheap 84,150; train 504,900;
  holdout 504,900.

```mermaid
flowchart LR
    P["10 seeded runs<br/>99 Float32 parents"] --> E["1 new forward edge<br/>per parent"]
    E --> T["8 fixed new-edge<br/>weight draws"]
    E --> W["8 matched weight-only<br/>nudges (same Float32 budget)"]
    T --> C["Cheap sample: 3<br/>preregistered rules"]
    W --> C
    C --> F["Confirm on full train"]
    C --> H["Confirm on untouched holdout"]
```

Issue numbers cited: #4162 (this issue: Experiment: Separate topology gains from
new-edge weight-placement luck); #4160 (the sibling connectivity-prior study
whose corpus and seeding are reused).

## Acceptance Criteria

- **missing** — "Read and pin the full method before reproducing it" — reason:
  the arXiv fetch failed in this sandbox (`proxy refused the
  connection`), so
  the method is this repository's reading of the issue, and every artefact says
  so.

## Test Plan

- Added `test/scripts/TopologyWeightLuckStudy.ts`:
  - `drawNewEdgeWeights`: the eight values are Float32 and deterministic, and
    the global RNG is restored.
  - `buildTopologyVariant` adds exactly one synapse and leaves the parent
    unchanged.
  - `buildWeightOnlyVariant` moves exactly one weight by the matched budget.
  - `chooseNewEdge` picks an absent forward pair and refuses a full creature,
    with a positive control.
  - Hand-computed `summarise` arithmetic.
  - A lucky draw is selected by `best-draw` but not by `median-paired`.
  - `comparePrecision` returns benefit, harm and no-benefit.
  - `validateSettings` names the field it refuses.
  - A tiny end-to-end study is complete and reproducible, and selection is the
    same when the holdout changes.
- `test/scripts/ConnectivityPriorStudy.ts` (unchanged) still passes after
  `withSeededGlobals` was extracted from `runArm`, so the refactor kept the old
  behaviour.
- `deno test --allow-all test/scripts/TopologyWeightLuckStudy.ts test/scripts/ConnectivityPriorStudy.ts`:
  23 passed, 0 failed.
- `./quality.sh --rust-scorer-bin=<built rust_scorer>` on the final code commit:
  exit 0, 10365 passed, 0 failed, 50 ignored (12m23s). This host has no
  `rust_scorer` on PATH, and plain `./quality.sh` stops at its pre-flight, so
  the binary was built from a fresh NEAT-AI-scorer clone.
- Tests removed: none. Assertions removed: none.

Not done: the paper was not read; there were no runs on production or private
corpora; AddNeuron mutations were not studied. Remaining risk: the result comes
from a synthetic 4-input regression and does not transfer to production on its
own.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
