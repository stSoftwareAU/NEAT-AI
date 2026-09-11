# Surrogate uncertainty and acquisition (Issue #3933)

> [!IMPORTANT]
> **The surrogate path must not run in production without this guard.**
> `preSelection.uncertainty.enabled` defaults to `true` and is meant to stay
> that way. Turning it off reverts to ranking candidates by predicted score,
> which is the one policy that guarantees the model is never corrected where it
> is wrong. `enabled: false` exists for the A/B arm that measures what the guard
> is worth, and for nothing else.

[Jin (2011)](comparison/REFERENCES.md) §4–§5 returns repeatedly to one failure
mode, and it is the paper's most practical contribution: a surrogate does not
merely make mistakes, it makes **consistent** mistakes, and an evolutionary
algorithm finds and exploits them. The search converges on an optimum of the
_model_ that is not an optimum of the _objective_ — a **false optimum** — and
the fitness trace looks excellent throughout, because the fitness trace is drawn
from the model.

The GRQ regime is unusually exposed to this. Accepted improvements on the
forward-only lineage run around `1e-05`. A surrogate does not need to be badly
wrong to wreck that; it needs to be wrong by `1e-04` in a consistent direction,
which is _inside the noise of its own validation_ and therefore invisible to any
aggregate accuracy metric.

This guard is the remedy, in three refusals and a detector.

## The shape of it

```mermaid
flowchart TD
  C[surplus offspring] --> D[structural descriptor #3929]
  D --> R{covered by the archive?}
  R -->|no| O["REFUSAL: out-of-distribution<br/>no number is returned"]
  R -->|yes| P["prediction:<br/>value + mandatory uncertainty"]
  O --> A
  P --> A{exact-evaluation allocation}
  A -->|band 1| B1[every refusal, first]
  A -->|band 2| B2["uncertainty floor:<br/>least-certain candidates,<br/>whatever they scored"]
  A -->|band 3| B3["acquisition rule:<br/>expected improvement<br/>or confidence bound"]
  B1 --> E[exact evaluation]
  B2 --> E
  B3 --> E
  E --> M["signed-bias drift monitor:<br/>predicted - exact"]
  M -->|one-directional streak| X["DISABLE the surrogate path<br/>for the rest of the run"]
  M -->|symmetric| C
```

### 1. Uncertainty is mandatory on the interface

[`src/surrogate/UncertainSurrogate.ts`](../src/surrogate/UncertainSurrogate.ts)
defines a verdict as either a prediction carrying a **mandatory** uncertainty,
or a **refusal**. There is no third shape, no nullable field and no optional
property: it is impossible to consume a prediction without confronting its
confidence. A model family that cannot produce one either gains it by bootstrap
or ensemble variance, or is not eligible to implement the interface.

The production screen ([`SurrogateScreen`](../src/NEAT/OffspringScreen.ts))
builds its uncertainty from two parts, both in score units:

- **local disagreement** — the distance-weighted standard deviation of the `k`
  neighbour scores; neighbours that disagree about a region are the model saying
  it cannot resolve it;
- **distance from the data** — the window's own score spread, scaled by how far
  the candidate sits from its nearest neighbour as a fraction of the coverage
  radius.

### 2. An acquisition rule, not an argmax

[`src/surrogate/ExactEvaluationAllocator.ts`](../src/surrogate/ExactEvaluationAllocator.ts)
allocates the exact evaluations in three bands, in this order:

1. **every refusal**, because only a true evaluation can say what an unmeasured
   candidate is worth;
2. **the uncertainty floor** — a stated minimum fraction of the slots goes to
   the candidates the model is least sure about, _regardless of predicted
   quality_. This is the band that costs apparent performance in the short run,
   and it is enforced and then asserted: an allocation that falls below it
   throws rather than quietly degenerating into an argmax;
3. **the acquisition rule** fills what is left — expected improvement (Jones,
   Schonlau & Welch 1998) or the confidence bound.

Both rules are named for their minimisation form in the literature; NEAT-AI
scores are higher-is-better, so each is computed on its maximisation mirror.

### 3. Refuse to extrapolate

[`src/surrogate/CoverageRegion.ts`](../src/surrogate/CoverageRegion.ts) draws
the region the archive actually covers and refuses anything outside it. Two
tests, and a candidate need only fail one:

- **the box** — every descriptor slot must sit inside the range the archive
  spans, widened by `coverageMargin` standard deviations;
- **the radius** — the nearest archived creature must be closer than the
  `coverageQuantile` quantile of the archive's own nearest-neighbour distances,
  times `coverageFactor`.

In a NEAT population an out-of-distribution candidate is not an edge case: novel
topologies are the whole mechanism, and they are by construction the points the
model has no data near. A near-zero out-of-distribution rate is therefore
**suspicious**, not a success.

### The detector: signed-bias drift

[`src/surrogate/DriftMonitor.ts`](../src/surrogate/DriftMonitor.ts) compares
every prediction against the exact score that arrives for it later, and tracks
**signed** bias rather than absolute error:

```text
bias ratio = mean(predicted - exact) / mean(|predicted - exact|)
```

`±1` when every residual points the same way, near `0` for symmetric noise of
any magnitude. The reading is scale-free by construction, which is what lets it
see a `1e-04` bias on a lineage whose improvements are `1e-05`.
`driftGenerations` consecutive generations past `driftBiasRatio` **in the same
direction** disable the surrogate path for the rest of the run, loudly:

```text
[NEAT-AI] Surrogate DISABLED at generation 37: the surrogate over-predicted in
one direction for 5 consecutive generation(s) (bias ratio 0.812, mean signed
bias 1.104e-4). A one-directional bias is the false-optimum signature of Jin
(2011) §5, so the surrogate path is off for the rest of this run and every
candidate is evaluated exactly.
```

Disabled means **not consulted**: the stage stops over-generating entirely and
every creature takes a true evaluation.

## Configuration

Nested under `preSelection.uncertainty`
([`SurrogateUncertaintyConfig`](../src/config/SurrogateUncertaintyConfig.ts)).
Invalid values are rejected, never clamped.

| Option                   | Default | Meaning                                                                                   |
| ------------------------ | ------- | ----------------------------------------------------------------------------------------- |
| `enabled`                | `true`  | The guard runs. Production must leave this on.                                            |
| `acquisition`            | `"ei"`  | `"ei"` (expected improvement) or `"lcb"` (confidence bound).                              |
| `kappa`                  | `1.5`   | Exploration weight of `"lcb"`; `0` reduces it to an argmax.                               |
| `minUncertaintyFraction` | `0.2`   | Floor on the exact evaluations reserved for the least-certain candidates. `1` is refused. |
| `coverageQuantile`       | `0.95`  | Quantile of the archive's nearest-neighbour distances setting the radius.                 |
| `coverageFactor`         | `1.5`   | Multiplier on that radius.                                                                |
| `coverageMargin`         | `0.5`   | Standard deviations beyond the observed range still counted as covered.                   |
| `driftGenerations`       | `5`     | Consecutive one-directional generations that disable the path.                            |
| `driftBiasRatio`         | `0.5`   | How one-directional a generation must be to count.                                        |
| `driftMinSamples`        | `8`     | Residuals a generation needs before its reading counts.                                   |

```ts
const creature = await neat.evolveDataSet(dataSet, {
  preSelection: {
    ratio: 3,
    screen: "surrogate",
    uncertainty: { acquisition: "lcb", kappa: 2, minUncertaintyFraction: 0.25 },
  },
});
```

## Diagnostics

Three numbers per run, and they are the ones that say whether the surrogate is
helping or converging the search onto a false optimum. They are logged per
generation and available from `PreSelection.surrogateGuard?.runDiagnostics`:

- **signed bias** — per generation and per run. A sustained one-directional
  trend disables the path automatically.
- **uncertainty-allocation fraction** — the share of exact evaluations spent on
  refused or least-certain candidates. **If it drifts to zero the acquisition
  rule has degenerated to an argmax**, which is why it is asserted against the
  configured floor rather than merely reported.
- **out-of-distribution rate** — per generation. Near-zero on a NEAT population
  should be investigated, not celebrated.

```text
[NEAT-AI] Surrogate acquisition (ei): 18 exact evaluation(s) over 54 candidate(s)
— 3 out-of-distribution, 2 on the uncertainty floor, 13 by acquisition; OOD rate
5.6%, uncertainty allocation 27.8% (floor 20.0%)
```

## The A/B: guarded against unguarded, on final exact score

[`scripts/surrogate_uncertainty_ab.ts`](../scripts/surrogate_uncertainty_ab.ts)
runs the same seed, the same starting population and the same surrogate screen
with the guard on and off, and judges the pair on **final exact score** over at
least 100 generations — the script refuses a shorter horizon.

```bash
deno run --allow-read --allow-write --allow-env --allow-ffi \
  scripts/surrogate_uncertainty_ab.ts --generations=120 --replicates=3 \
  --json=docs/evidence/surrogate-uncertainty-3933.json
```

Measured at 120 generations over 3 seeds, population 24
([`docs/evidence/surrogate-uncertainty-3933.md`](evidence/surrogate-uncertainty-3933.md),
machine-readable in
[`surrogate-uncertainty-3933.json`](evidence/surrogate-uncertainty-3933.json)):

| Arm                                 | Mean final exact score | vs unguarded |
| ----------------------------------- | ---------------------- | ------------ |
| `unguarded` (predicted-rank argmax) | `-0.018134`            | —            |
| `guarded`                           | `-0.015735`            | `+2.399e-3`  |

Per seed the guarded arm finished ahead on two of three (`-0.004622` vs
`-0.003406`; `-0.006650` vs `-0.011385`; `-0.035934` vs `-0.039612`). The
guarded arm spent **25.3 %** of its exact evaluations on uncertainty and refused
to predict **3.6 %** of candidates; the drift monitor did not fire on any of the
three runs.

**Read that cautiously and in one direction only.** Three seeds on a synthetic
regression is not evidence that the guard buys score, and the guard was never
argued for on those grounds — it is argued for because the failure it prevents
is invisible in the fitness trace. What the A/B does establish is the thing
worth establishing: paying a quarter of the exact evaluations for exploration
did **not** cost the endpoint on this objective. The single-seed run at 100
generations went the other way (`-0.008066` guarded against `-0.004832`
unguarded), which is exactly the variance you would expect at this sample size
and is reported here rather than dropped.

## See also

- [PRE_SELECTION.md](PRE_SELECTION.md) — the stage the guard sits in (Issue
  #3932).
- [EVOLUTION_CONTROL.md](EVOLUTION_CONTROL.md) — the model-management policy it
  composes with (Issue #3931).
- [EVALUATION_ARCHIVE.md](EVALUATION_ARCHIVE.md) — the archive whose coverage
  the out-of-distribution test is drawn against (Issue #3929).
- [comparison/REFERENCES.md](comparison/REFERENCES.md) — Jin (2011); Jones,
  Schonlau & Welch (1998).
