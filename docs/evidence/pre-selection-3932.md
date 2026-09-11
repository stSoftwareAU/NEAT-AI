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
| `control`     | −0.047237         | —                     | −0.047237           | —                   |
| `sampled`     | −0.017237         | +3.00e-2 (9/10 seeds) | −0.047247           | −9.49e-6 (4/10)     |
| `surrogate`   | −0.033025         | +1.42e-2 (7/10)       | −0.069645           | **−2.24e-2** (5/10) |
| `random-only` | −0.016846         | +3.04e-2 (9/10)       | −0.049942           | −2.71e-3 (5/10)     |

**No arm improved at equal record budget.** At equal _generations_ all three
over-generated arms beat control — but `random-only`, which never consults its
screen, is the best of them. That gain is not the screen: a surplus fills the
population when crossover fails, and this harness's crossover fails often
(control bred a mean of 6.8 offspring per generation against 22 slots). Charge
the extra exact evaluations that fuller population costs and the advantage
disappears.

Run-to-run variability is real and is not seed noise. Both arms of an invocation
share one seeded corpus, one seeded starting population and one seeded global
generator, but `Offspring.breed` mints new neuron identities with
`crypto.randomUUID()`, which no seed reaches — so a run is same-seed **within**
an invocation and not bit-reproducible **across** invocations. Repeated
invocations moved the equal-budget deltas by ±2e-2, the size of the deltas
themselves, and flipped their sign. The honest reading is **no improvement
demonstrated**; the diversity result below is the finding that survived
repetition.

### Diversity — the regression that would not show in the fitness trace

Mean over all 30 generations and all ten seeds, measured with the production
functions.

| Arm           | Species count | vs control | Mean genetic distance | vs control  |
| ------------- | ------------- | ---------- | --------------------- | ----------- |
| `control`     | 2.92          | —          | 0.1308                | —           |
| `sampled`     | 3.63          | +0.71      | 0.1147                | **−0.0161** |
| `surrogate`   | 3.37          | +0.45      | 0.1120                | **−0.0188** |
| `random-only` | 4.92          | +2.00      | 0.1541                | +0.0233     |

**Both screens cut mean genetic distance; keeping the same surplus at random
raises it.** Every over-generated arm sees more offspring, so a screen that were
neutral on diversity would look like `random-only` — and neither does. Across
repeated invocations the screened arms' distance deficit ranged from −0.016 to
−0.088 while `random-only` stayed at or above control, so the direction is
stable even though the magnitude is not. Species count rises in every
over-generated arm because more offspring survive to be speciated at all; it is
the **distance** number that carries the warning, and it is the diversity sink
the issue predicted.

This is the measurement that says a screened run must never be judged on its
fitness trace alone.

### Screen rank of the creatures that became elites

One observation per creature: an elite that survives many generations is counted
once, so the distribution describes the screen rather than elitism.

| Arm           | Screened elites | Mean screen percentile | Kept by the uniform draw |
| ------------- | --------------- | ---------------------- | ------------------------ |
| `sampled`     | 317             | **0.053**              | 54                       |
| `surrogate`   | 231             | 0.298                  | 65                       |
| `random-only` | 313             | 0.411                  | 313                      |

`0` is the screen's top pick, `1` its worst, and `random-only` is the
no-information baseline. The `"sampled"` screen is strongly predictive here —
eventual elites come from the top 5 % of its ordering — which is unsurprising
given it is the true objective over a twentieth of the corpus. The `"surrogate"`
screen at 0.298 is modestly better than picking at random: weakly informative on
this objective rather than useless, and certainly not anti-correlated. Neither
number licenses the stage; both are what the diagnostic is for.

### Screening cost

The screen's own wall-clock, as `PreSelectionSummary.screenMs` measures it — the
sort, the uniform draw and the partitioning are not the screen.

| Arm         | Mean screen ms/generation | Max |
| ----------- | ------------------------- | --- |
| `sampled`   | 4.95                      | 23  |
| `surrogate` | 0.66                      | 13  |

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
