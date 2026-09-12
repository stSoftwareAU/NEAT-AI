# Surrogate uncertainty guard, same-seed A/B (Issue #3933)

Jin (2011) §4–§5 names the failure the guard exists to prevent: a surrogate
makes **consistent** mistakes, the search finds and exploits them, and the
fitness trace looks excellent the whole way because it is drawn from the model.
[`docs/SURROGATE_UNCERTAINTY.md`](../SURROGATE_UNCERTAINTY.md) is the guard;
this is the measurement of what it costs.

Harness:
[`scripts/surrogate_uncertainty_ab.ts`](../../scripts/surrogate_uncertainty_ab.ts).
Arithmetic:
[`scripts/lib/preSelectionAB.ts`](../../scripts/lib/preSelectionAB.ts).
Machine-readable run:
[`surrogate-uncertainty-3933.json`](./surrogate-uncertainty-3933.json).

```bash
deno task surrogate-uncertainty-ab --generations=120 --replicates=3 \
  --seed=3933 --json=docs/evidence/surrogate-uncertainty-3933.json
```

## What was measured, and what it is not

Two arms, same seed, same seeded starting population, same `"surrogate"` screen.
The only difference is the guard:

- **`unguarded`** — the Issue #3932 behaviour: rank by predicted score, keep the
  top of the ranking. This is the policy that guarantees the model is never
  corrected where it is wrong.
- **`guarded`** — refusals routed to exact evaluation, a 20 % floor of the exact
  evaluations spent on the least-certain candidates, expected improvement
  filling the rest, and the signed-bias monitor watching for a false optimum.

The objective is **synthetic**: the exact fitness is the mean squared error over
a 4,000-record corpus, scored in-process by activating the creature. The
creatures, the crossover, the mutation operators, speciation and the shipped
`PreSelection` stage with its guard are real. **This says nothing about how a
5,317-neuron GRQ creature behaves.** It says what the guard costs an endpoint
when a quarter of the exact evaluations are deliberately spent where the model
is unsure.

## Result — 120 generations, 3 seeds, population 24

| Arm         | Mean final exact score | Mean exact evaluations | vs unguarded |
| ----------- | ---------------------- | ---------------------- | ------------ |
| `unguarded` | `-0.012964`            | 1,718                  | —            |
| `guarded`   | `-0.005990`            | 2,158                  | `+6.974e-3`  |

Per seed:

| Seed | `unguarded` | `guarded`   | Delta       |
| ---- | ----------- | ----------- | ----------- |
| 3933 | `-0.030774` | `-0.004293` | `+2.648e-2` |
| 3934 | `-0.005631` | `-0.001658` | `+3.973e-3` |
| 3935 | `-0.002488` | `-0.012019` | `-9.531e-3` |

Guard diagnostics, averaged over the three guarded runs: uncertainty allocation
**25.6 %** of the slots the acquisition rule handed out — **18.6 %** of _every_
exact evaluation the stage spent, the uniform survivor draw included — and an
out-of-distribution rate of **3.9 %**.

**The drift monitor fired on one of the three runs.** Seed 3934 disabled the
surrogate path at generation 120 after a streak of one-directional bias; the
other two ran to the end with per-generation bias ratios of `-0.13` and `+0.24`,
comfortably inside the `0.5` threshold. That is the detector doing its job on a
real search rather than on a constructed fixture.

## Read it this way

- **The arms did not spend the same budget.** The guarded arm paid for about 26
  % more exact evaluations (2,158 against 1,718) and considered about 77 % more
  candidates. A better endpoint bought with more evaluations is not an
  efficiency result, and this table is not one.
- **This is not evidence that the guard buys score.** Three seeds on a synthetic
  regression, with a per-seed spread an order of magnitude wider than the mean
  difference and one seed going the _other_ way, cannot carry that claim. The
  guard was never argued for on those grounds — it is argued for because the
  failure it prevents is invisible in the fitness trace.
- **What it does establish** is the thing worth establishing before shipping a
  guard that costs exact evaluations: reserving a quarter of the allocation for
  uncertainty did not collapse the endpoint, and the detector fires on a real
  run rather than only in a test.
- **An out-of-distribution rate near zero would be the suspicious reading**, not
  the reassuring one: on a NEAT population novel topologies are the mechanism,
  and they are by construction the points the model has no data near.

---

**Up to:** [`docs/SURROGATE_UNCERTAINTY.md`](../SURROGATE_UNCERTAINTY.md) ·
[`docs/README.md`](../README.md) (topic index).
