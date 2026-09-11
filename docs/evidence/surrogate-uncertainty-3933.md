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

| Arm         | Mean final exact score | vs unguarded |
| ----------- | ---------------------- | ------------ |
| `unguarded` | `-0.018134`            | —            |
| `guarded`   | `-0.015735`            | `+2.399e-3`  |

Per seed:

| Seed | `unguarded` | `guarded`   | Delta       |
| ---- | ----------- | ----------- | ----------- |
| 3933 | `-0.003406` | `-0.004622` | `-1.216e-3` |
| 3934 | `-0.011385` | `-0.006650` | `+4.735e-3` |
| 3935 | `-0.039612` | `-0.035934` | `+3.678e-3` |

Guard diagnostics, averaged over the three guarded runs: uncertainty allocation
**25.3 %**, out-of-distribution rate **3.6 %**, and the drift monitor fired on
**none** of the three.

## Read it this way

- **This is not evidence that the guard buys score.** Three seeds on a synthetic
  regression, with a per-seed spread an order of magnitude wider than the mean
  difference, cannot carry that claim, and the guard was never argued for on
  those grounds — it is argued for because the failure it prevents is invisible
  in the fitness trace.
- **What it does establish** is the thing worth establishing before shipping a
  guard that costs exact evaluations: spending a quarter of them on exploration
  did **not** cost the endpoint on this objective.
- **The negative reading is reported, not dropped.** An earlier single-seed run
  at 100 generations went the other way — `-0.008066` guarded against
  `-0.004832` unguarded. That is exactly the variance the per-seed table above
  would predict at n=1.
- **An out-of-distribution rate near zero would be the suspicious reading**, not
  the reassuring one: on a NEAT population novel topologies are the mechanism,
  and they are by construction the points the model has no data near.

---

**Up to:** [`docs/SURROGATE_UNCERTAINTY.md`](../SURROGATE_UNCERTAINTY.md) ·
[`docs/README.md`](../README.md) (topic index).
