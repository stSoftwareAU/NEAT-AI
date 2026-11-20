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
| `control`     | −0.052486         | —                     | −0.052486           | —                   |
| `sampled`     | −0.013182         | +3.93e-2 (9/10 seeds) | −0.045907           | +6.58e-3 (5/10)     |
| `surrogate`   | −0.015830         | +3.67e-2 (8/10)       | −0.059782           | **−7.30e-3** (4/10) |
| `random-only` | −0.027564         | +2.49e-2 (7/10)       | −0.054290           | −1.80e-3 (3/10)     |

**No arm showed a demonstrated improvement at equal record budget.** `"sampled"`
came out ahead on the mean (+6.58e-3) but on only 5 of 10 seeds; `"surrogate"`
and `random-only` were behind control. At equal _generations_ all three
over-generated arms beat control, and both screened arms also beat `random-only`
(+3.93e-2 and +3.67e-2 against +2.49e-2), so part of that gain is the screens'.
Much of it is the surplus: a surplus fills the population when crossover fails,
and this harness's crossover fails often (control bred a mean of 6.4 offspring
per generation against 22 slots). Charge the extra exact evaluations that fuller
population costs and the advantage is gone or within seed-to-seed spread.

Every number here is reproducible from the stated seeds. Each arm's corpus,
starting population, crossover and mutation draw from one seeded global
generator; until Issue #4170, `createNeatConfig` replaced that generator with an
unseeded one at the start of every arm, so crossover and mutation ran unseeded
and the previous version of this file reported numbers that moved by about ±2e-2
between invocations. Two invocations of the command above, on the fixed harness,
produced identical results in every field except the wall-clock `screenMs`
timings. `Offspring.breed` still mints neuron identities with
`crypto.randomUUID()`, which no seed reaches, but in those two invocations that
changed no reported number. The honest reading of the endpoint is still **no
improvement demonstrated**.

### Diversity — the regression that would not show in the fitness trace

Mean over all 30 generations and all ten seeds, measured with the production
functions.

| Arm           | Species count | vs control | Mean genetic distance | vs control  |
| ------------- | ------------- | ---------- | --------------------- | ----------- |
| `control`     | 3.02          | —          | 0.1256                | —           |
| `sampled`     | 3.59          | +0.57      | 0.0986                | **−0.0270** |
| `surrogate`   | 6.99          | +3.97      | 0.1501                | +0.0244     |
| `random-only` | 4.44          | +1.42      | 0.1272                | +0.0015     |

**The `"sampled"` screen cuts mean genetic distance; the `"surrogate"` screen
and keeping the same surplus at random do not.** Every over-generated arm sees
more offspring, so a screen that were neutral on diversity would look like
`random-only`, which sits at control (+0.0015). `"sampled"`, the screen closest
to the true objective, sits 0.027 below control: that is the diversity sink the
issue predicted. `"surrogate"`, which ranks only weakly on this objective
(below), raised both species count and distance. The previous, unseeded version
of this file reported both screens cutting distance; the `"surrogate"` half of
that did not survive seeding. Species count rises in every over-generated arm
because more offspring survive to be speciated at all; it is the **distance**
number that carries the warning.

This is the measurement that says a screened run must never be judged on its
fitness trace alone.

### Screen rank of the creatures that became elites

One observation per creature: an elite that survives many generations is counted
once, so the distribution describes the screen rather than elitism.

| Arm           | Screened elites | Mean screen percentile | Kept by the uniform draw |
| ------------- | --------------- | ---------------------- | ------------------------ |
| `sampled`     | 340             | **0.063**              | 64                       |
| `surrogate`   | 298             | 0.289                  | 69                       |
| `random-only` | 251             | 0.399                  | 251                      |

`0` is the screen's top pick, `1` its worst, and `random-only` is the
no-information baseline. The `"sampled"` screen is strongly predictive here —
eventual elites come from the top 7 % of its ordering — which is unsurprising
given it is the true objective over a twentieth of the corpus. The `"surrogate"`
screen at 0.289 is modestly better than picking at random: weakly informative on
this objective rather than useless, and certainly not anti-correlated. Neither
number licenses the stage; both are what the diagnostic is for.

### Screening cost

The screen's own wall-clock, as `PreSelectionSummary.screenMs` measures it — the
sort, the uniform draw and the partitioning are not the screen.

| Arm         | Mean screen ms/generation | Max |
| ----------- | ------------------------- | --- |
| `sampled`   | 5.57                      | 15  |
| `surrogate` | 1.95                      | 9   |

These are wall-clock readings from a shared host, so indicative only, and they
are the one field that differs between invocations. Both stay a small fraction
of a generation on this objective. The `"sampled"` figure scales with the cheap
rate and the corpus, so a production-sized corpus at rate 0.05 would cost 5 % of
an exact sweep per screened candidate — at ratio 3 that is roughly 15 % of one
exact sweep per generation, which is the number to watch.

## What this does not say

- **Nothing about a 5,317-neuron GRQ creature.** The creatures here are tiny and
  the corpus is synthetic. The stage is what was measured, not the lineage.
- **Nothing that licenses turning the stage on in production.** At equal record
  budget no arm showed a demonstrated improvement (the one positive mean,
  `"sampled"`, won on half the seeds), and the `"sampled"` screen cost genetic
  diversity. The stage ships **off**, and this file is the reason.
- **Nothing about `"sampled"` inside the evolution loop.** The harness supplies
  its own cheap evaluator; the loop has none, and refuses that screen rather
  than fabricating one.

---

**Up to:** [`docs/PRE_SELECTION.md`](../PRE_SELECTION.md) ·
[`docs/README.md`](../README.md) (topic index).
