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

Every number below is in the artefact's `summary` block, one entry per arm, so
it can be re-derived without re-running. (The `generations` traces in the
artefact are a **sample** — every fifth generation plus the ends — so averaging
those gives a different answer from the one stated here.)

### Endpoint — exact score of the final creature, higher is better

| Arm           | Equal generations | vs control            | Equal record budget | vs control          |
| ------------- | ----------------- | --------------------- | ------------------- | ------------------- |
| `control`     | −0.040396         | —                     | −0.040396           | —                   |
| `sampled`     | −0.012406         | +2.80e-2 (7/10 seeds) | −0.055391           | **−1.50e-2** (3/10) |
| `surrogate`   | −0.032478         | +7.92e-3 (6/10)       | −0.057664           | **−1.73e-2** (1/10) |
| `random-only` | −0.015769         | +2.46e-2 (7/10)       | −0.058123           | **−1.77e-2** (3/10) |

**No arm demonstrated an improvement at equal record budget — every one of them
is a regression there.** At equal _generations_ all three over-generated arms
beat control, but so does `random-only`, which never consults its screen. That
gain is not the screen: a surplus fills the population when crossover fails, and
this harness's crossover fails often (control bred a mean of 6.8 offspring per
generation against 22 slots). Charge the extra exact evaluations that fuller
population costs, and the advantage disappears.

Run-to-run variability is real and is not seed noise: `Offspring.breed` mints
new neuron identities with `crypto.randomUUID()`, so the harness is same-seed
**within** an invocation — every arm starts from the same seeded population,
corpus and global generator — but is not bit-reproducible **across**
invocations. Repeated invocations moved the equal-budget deltas by around ±2e-2,
which is the size of the deltas themselves. The honest reading is _no
improvement demonstrated_, and the diversity result below is the finding.

### Diversity — the regression that would not show in the fitness trace

Mean over all 30 generations and all ten seeds, measured with the production
functions.

| Arm           | Species count | vs control | Mean genetic distance | vs control  |
| ------------- | ------------- | ---------- | --------------------- | ----------- |
| `control`     | 3.16          | —          | 0.1501                | —           |
| `sampled`     | 3.58          | +0.42      | 0.1028                | **−0.0474** |
| `surrogate`   | 3.41          | +0.25      | 0.0915                | **−0.0586** |
| `random-only` | 4.46          | +1.30      | 0.1550                | +0.0048     |

**Both screens cut mean genetic distance by a third to 40 %**, and the uniform
draw at `randomSurvivorFraction: 0.25` does not prevent it — `random-only`,
which keeps the same surplus without consulting the screen at all, holds
distance slightly _above_ control. Species count rises in every over-generated
arm because more offspring survive to be speciated at all; it is the
**distance** number that carries the warning, and it is exactly the diversity
sink the issue predicted.

This is the measurement that says a screened run must never be judged on its
fitness trace alone.

### Screen rank of the creatures that became elites

| Arm           | Screened elites | Mean screen percentile | Kept by the uniform draw |
| ------------- | --------------- | ---------------------- | ------------------------ |
| `sampled`     | 347             | **0.030**              | 57                       |
| `surrogate`   | 354             | 0.289                  | 88                       |
| `random-only` | 366             | 0.382                  | 366                      |

`0` is the screen's top pick, `1` its worst, and `random-only` is the
no-information baseline. The `"sampled"` screen is strongly predictive here —
eventual elites come from the top 3 % of its ordering — which is unsurprising
given it is the true objective over a twentieth of the corpus. The `"surrogate"`
screen at 0.289 is modestly better than picking at random: weakly informative on
this objective rather than useless, and certainly not anti-correlated. Neither
number licenses the stage; both are what the diagnostic is for.

### Screening cost

| Arm         | Mean screen ms/generation | Max |
| ----------- | ------------------------- | --- |
| `sampled`   | 3.34                      | 16  |
| `surrogate` | 0.65                      | 2   |

Both stay a small fraction of a generation on this objective. The `"sampled"`
figure scales with the cheap rate and the corpus, so a production-sized corpus
at rate 0.05 would cost 5 % of an exact sweep per screened candidate — at ratio
3 that is roughly 15 % of one exact sweep per generation, which is the number to
watch.

## What this does not say

- **Nothing about a 5,317-neuron GRQ creature.** The creatures here are tiny and
  the corpus is synthetic. The stage is what was measured, not the lineage.
- **Nothing that licenses turning the stage on in production.** At equal record
  budget every arm was a regression, and both screened arms cost genetic
  diversity. The stage ships **off**, and this file is the reason.
- **Nothing about `"sampled"` inside the evolution loop.** The harness supplies
  its own cheap evaluator; the loop has none, and refuses that screen rather
  than fabricating one.

---

**Up to:** [`docs/PRE_SELECTION.md`](../PRE_SELECTION.md) ·
[`docs/README.md`](../README.md) (topic index).
