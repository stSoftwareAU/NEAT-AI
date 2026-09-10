# Offspring pre-selection, measured (Issue #3932)

What over-generating and screening actually buys, and what it costs. Produced by
[`scripts/pre_selection_ab.ts`](../../scripts/pre_selection_ab.ts); the
machine-readable artefact is
[`pre-selection-3932.json`](pre-selection-3932.json).

```bash
deno task pre-selection-ab --generations=30 --replicates=10 \
  --json=docs/evidence/pre-selection-3932.json
```

## What was run

Ten seeds (3932–3941), 30 generations, population 24, elitism 2, a synthetic
4,000-record regression, over-generation ratio 3, cheap rate 0.05. Four arms:

| Arm           | Ratio | Screen        | Random survivors |
| ------------- | ----- | ------------- | ---------------- |
| `control`     | 1     | `"none"`      | —                |
| `sampled`     | 3     | `"sampled"`   | 0.25             |
| `surrogate`   | 3     | `"surrogate"` | 0.25             |
| `random-only` | 3     | `"surrogate"` | **1.0**          |

`random-only` is the control that matters: the same surplus, kept **entirely at
random**. An arm that cannot beat it is not being helped by its screen.

Real in this harness: the creatures, the crossover (`Offspring.breed`), the
mutation operators (`Mutator`), speciation (`Genus`), genetic distance
(`geneticCompatibility`), and the `PreSelection` stage with its screens. The
corpus is synthetic and scored in-process — the 21 GiB production corpus is
behind the Rust scorer and the cheap fidelity of Issue #3926 lives in the data
pipeline. Cost is counted in **records scored**, which is what the real corpus
charges for.

## Result

### Endpoint — exact score of the final creature, higher is better

| Arm           | Equal generations | vs control                | Equal record budget | vs control          |
| ------------- | ----------------- | ------------------------- | ------------------- | ------------------- |
| `control`     | −0.051522         | —                         | −0.051522           | —                   |
| `sampled`     | −0.022140         | **+2.94e-2** (8/10 seeds) | −0.036024           | **+1.55e-2** (7/10) |
| `surrogate`   | −0.025426         | +2.61e-2 (8/10)           | −0.058817           | −7.30e-3 (4/10)     |
| `random-only` | −0.019505         | +3.20e-2 (9/10)           | −0.054573           | −3.05e-3 (4/10)     |

**Read the `random-only` row first.** At equal generations it is the _best_ arm.
Most of the gain from over-generating is not the screen — it is that a surplus
fills the population when crossover fails, and this harness's crossover fails
often (control bred a mean of 6.8 offspring per generation against 22 slots).
Once the extra exact evaluations that fuller population costs are charged (equal
record budget), only `sampled` is still ahead of control, and only on 7/10
seeds.

Run-to-run variability is real and is not seed noise: `Offspring.breed` mints
new neuron identities with `crypto.randomUUID()`, so the harness is same-seed
**within** an invocation — every arm starts from the same seeded population,
corpus and global generator — but is not bit-reproducible **across**
invocations. Repeated invocations moved the equal-budget deltas by around ±2e-2,
which is the same size as the deltas themselves. Treat the endpoint result as
_no reliable improvement demonstrated_, and the diversity result below as the
finding.

### Diversity — the regression that would not show in the fitness trace

Mean over all generations and seeds, measured with the production functions.

| Arm           | Species count | vs control | Mean genetic distance | vs control  |
| ------------- | ------------- | ---------- | --------------------- | ----------- |
| `control`     | 3.01          | —          | 0.1774                | —           |
| `sampled`     | 3.67          | +0.66      | 0.0926                | **−0.0848** |
| `surrogate`   | 3.39          | +0.38      | 0.0896                | **−0.0878** |
| `random-only` | 4.18          | +1.17      | 0.1471                | −0.0303     |

**Both screens roughly halve mean genetic distance**, and the uniform draw at
`randomSurvivorFraction: 0.25` does not prevent it — `random-only`, which keeps
the same surplus without consulting the screen at all, holds distance far closer
to control. Species count rises in every over-generated arm because more
offspring survive to be speciated at all; it is the _distance_ number that
carries the warning, and it is exactly the diversity sink the issue predicted.

This is the measurement that says a screened run must not be shipped on a
fitness trace alone.

### Screen rank of the creatures that became elites

| Arm           | Screened elites | Mean screen percentile | Kept by the uniform draw |
| ------------- | --------------- | ---------------------- | ------------------------ |
| `sampled`     | 471             | **0.063**              | 67                       |
| `surrogate`   | 404             | 0.290                  | 88                       |
| `random-only` | 463             | 0.356                  | 463                      |

`0` is the screen's top pick, `1` its worst. The `random-only` row is the
no-information baseline. The `"sampled"` screen is strongly predictive here —
eventual elites come from the top 6 % of its ordering — which is unsurprising
given it is the true objective over a twentieth of the corpus. The `"surrogate"`
screen at 0.29 is only modestly better than picking at random, so on this
objective it is weakly informative rather than useless, and it is certainly not
anti-correlated.

### Screening cost

| Arm         | Mean screen ms/generation | Max |
| ----------- | ------------------------- | --- |
| `sampled`   | 4.79                      | 25  |
| `surrogate` | 0.61                      | 2   |

Both stay a small fraction of a generation on this objective. The `"sampled"`
figure scales with the cheap rate and the corpus, so a production-sized corpus
at rate 0.05 would cost 5 % of an exact sweep per screened candidate — with
ratio 3 that is roughly 15 % of one exact sweep per generation, which is the
number to watch.

## What this does not say

- **Nothing about a 5,317-neuron GRQ creature.** The creatures here are tiny and
  the corpus is synthetic. The stage is what was measured, not the lineage.
- **Nothing that licenses turning the stage on in production.** At equal record
  budget no arm demonstrated a reliable improvement, and both screened arms cost
  genetic diversity. The stage ships **off**.
- **Nothing about `"sampled"` inside the evolution loop.** The harness supplies
  its own cheap evaluator; the loop has none, and refuses that screen rather
  than fabricating one.

---

**Up to:** [`docs/PRE_SELECTION.md`](../PRE_SELECTION.md) ·
[`docs/README.md`](../README.md) (topic index).
