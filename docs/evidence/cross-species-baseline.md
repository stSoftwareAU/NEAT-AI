# Cross-species breeding baseline — Issue #2654

This is the shared baseline for the cross-species breeding improvement track
(Issue #2653). Each downstream strategy sub-issue (anchor-derived pseudo-UUIDs
#2614, structural alignment, subgraph transplant #2177) **must** rerun the
harness in
[`bench/CrossSpeciesBreedingProportion.ts`](../../bench/CrossSpeciesBreedingProportion.ts)
against the **same fixtures** and report a two-sample Mann–Whitney U `p`-value
against the baseline numbers below.

> **Background (concept-level).** Earlier analysis of a production commit-log
> showed the cross-species shared-neuron proportion sitting in a
> low-single-digit regime with **a flat trend and high noise** — no monotonic
> improvement — which is the gap the strategy sub-issues are meant to close.
> That production dataset is not reproducible outside the organisation, so it is
> intentionally omitted here. The self-contained baseline below, built from the
> in-tree synthetic fixtures, is the canonical baseline every strategy sub-issue
> must beat.

## 1. Fresh baseline run on today's `main`

Run with:

```bash
deno run --allow-read --allow-write \
  bench/CrossSpeciesBreedingProportion.ts \
  --n=200 \
  --out=docs/evidence/cross-species-baseline.json
```

The harness loads
[`test/fixtures/cross-species/europa.json`](../../test/fixtures/cross-species/europa.json)
as the mother and
[`test/fixtures/cross-species/grq-cluster.json`](../../test/fixtures/cross-species/grq-cluster.json)
as the father. Both fixtures are compact (≈ 6.5 KB each), share the same
`input=4, output=2` shape, and have **fully disjoint hidden wire UUIDs** so
`geneticCompatibility(mother, father) = 0` — the exact low-compatibility regime
the strategy sub-issues target.

Each iteration invokes `Offspring.breed(mother, father)` with
`interSpeciesCrossoverThreshold = 0`, which forces breeding through the standard
`createCompatibleFather` crossover path. The shared JSON output is checked in at
[`docs/evidence/cross-species-baseline.json`](./cross-species-baseline.json).

### Baseline numbers (N = 200, today's `main`)

| Axis           | n   | mean   | stddev | min    | max    |
| -------------- | --- | ------ | ------ | ------ | ------ |
| **vs. mother** | 200 | 0.5000 | 0.0000 | 0.5000 | 0.5000 |
| **vs. father** | 200 | 0.5000 | 0.0000 | 0.5000 | 0.5000 |
| **min(both)**  | 200 | 0.5000 | 0.0000 | 0.5000 | 0.5000 |

`baselineCompatibility = 0.0` (zero hidden UUIDs shared between the parent
fixtures).

**Interpretation.** Standard crossover on zero-compatibility parents allocates
exactly half of each offspring's hidden neurons to the mother's UUIDs and half
to the father's UUIDs — a knife-edge distribution with zero variance. That
distribution is what each downstream strategy must beat: an effective
anchor-derived, structural, or transplant strategy will lift one or both of the
`vs. mother` / `vs. father` proportions above 0.5 (and necessarily the
`min(both)`), producing a Mann–Whitney U `p`-value `<= 0.05` against the
baseline distribution.

## 2. Statistical protocol

- **Test**: two-sample Mann–Whitney U / Wilcoxon rank-sum, two-sided, normal
  approximation with tie correction and continuity correction. Implemented in
  [`src/utils/Statistics.ts`](../../src/utils/Statistics.ts) (function
  `mannWhitneyU`). Unit tests in
  [`test/utils/Statistics.ts`](../../test/utils/Statistics.ts).
- **Sample size**: **N = 200** per parent pair.
- **Significance level**: **α = 0.05** (two-sided).
- **Decision rule**: a strategy improves the baseline when both (a) the mean of
  `min(both)` rises strictly above `0.5000` and (b) the two-sided `p` against
  the baseline `min(both)` distribution is `≤ 0.05`. Reporting only mean uplift
  without `p` is not sufficient — the baseline has zero variance, so even tiny
  means will read as "significant" under careless thresholds.

## 3. Reuse from strategy sub-issues

```ts
import {
  runBaseline,
  sharedNeuronProportion,
} from "../bench/CrossSpeciesBreedingProportion.ts";
import { mannWhitneyU } from "../src/utils/Statistics.ts";

// 1. Load the same fixtures.
// 2. Run runBaseline() once for "before".
// 3. Run the new strategy entry point N=200 times, collecting per-
//    offspring proportions the same way sharedNeuronProportion() does.
// 4. Feed both vsMother / vsFather / minOfBoth arrays into
//    mannWhitneyU() to obtain p against the baseline.
```
