# Evolution control, same-seed A/B (Issue #3931)

Jin (2011) §4 argues that **model management** — the policy deciding which
individuals earn the true fitness — is what makes surrogate-assisted evolution
work or fail.
[`src/NEAT/EvolutionControl.ts`](../../src/NEAT/EvolutionControl.ts) is that
policy; this is the measurement of it.

Harness:
[`scripts/evolution_control_ab.ts`](../../scripts/evolution_control_ab.ts).
Arithmetic:
[`scripts/lib/evolutionControlAB.ts`](../../scripts/lib/evolutionControlAB.ts).
Machine-readable run:
[`evolution-control-3931.json`](./evolution-control-3931.json).

```bash
deno task evolution-control-ab --generations=60 --replicates=10 \
  --json=docs/evidence/evolution-control-3931.json
```

## What was measured, and what it is not

The A/B needs a cheap evaluator to switch to, and **there is not one production
may use**:

- [Issue #3927](./rank-fidelity-3927.md) measured the sampled corpus on 46 real
  creatures and found **no rate safe** — including the rates whose Spearman ρ
  stayed above 0.95.
- [Issue #3930](./surrogate-feasibility-3930.md) could not decide its surrogate
  kill gate; Stage 2 was never built.

So an A/B "on the real corpus" would be measuring a path nothing is allowed to
take. What is measured instead is the **policy**, on a synthetic objective whose
exact fitness is the mean squared error over a 20,000-record corpus and whose
cheap fitness is the same arithmetic over a strided 5 % sub-sample of it — the
Issue #3926 mechanism in miniature, not noise added to a true score. The policy
object driving every arm is the shipped `EvolutionControl`, not a stand-in.

**This says nothing about how a 5,317-neuron GRQ creature behaves.** It says
what the policy does to an endpoint when the cheap ordering is imperfect, which
is the question the policy exists to answer.

Ten seeds (3931–3940), 60 generations each, population 24, elitism 2, cheap rate
0.05. Cost is counted in **records scored**: an exact evaluation costs the whole
corpus, a cheap one costs its sampled fraction — which is what the 21 GiB corpus
actually charges for.

## Result 1 — equal generations: `individual` is a regression

Final exact score of the creature each arm would ship, meaned over the ten
seeds. Higher is better.

| Arm          | Mean final exact | vs control |  Better on |
| ------------ | ---------------: | ---------: | ---------: |
| `none`       |        -4.449561 |          — |          — |
| `generation` |        -4.444883 |  +4.68e-03 | 5/10 seeds |
| `individual` |        -4.530791 |  -8.12e-02 | 2/10 seeds |

`generation` is a **wash** at equal generations: a coin-flip across seeds and a
mean difference two orders of magnitude below the spread between seeds.

`individual` is **worse**, on 8 of 10 seeds. That is the regression the issue
predicted in so many words — more evaluations bought more cheaply, at a worse
endpoint — and it is reported here as a negative result rather than buried. Its
cause is visible in the design: with `exactTopK: 2` and a 2-creature spread,
only 4 of 24 creatures per generation carry an exact score, so the population's
ordering is cheap almost everywhere and the incumbent is chosen from a very
narrow exact sample.

## Result 2 — equal record budget: both cheap arms win decisively

The GRQ regime does not buy generations, it buys wall-clock. Read at the point
where each arm had scored the same number of records:

| Arm          | Mean exact score at budget | vs control |   Better on |
| ------------ | -------------------------: | ---------: | ----------: |
| `none`       |                  -5.561302 |          — |           — |
| `generation` |                  -4.575336 |  +9.86e-01 | 10/10 seeds |
| `individual` |                  -4.530791 |  +1.03e+00 | 10/10 seeds |

At equal cost both cheap arms beat exact-everything on **every** seed. Control
had scored 2.88e+7 records after 60 generations; `generation` reached the same
budget having run far more generations, and `individual` cheaper still (6.64e+6
records for the full 60).

**The two results together are the finding.** A cheap policy buys real search
per unit cost, and it can still land on a worse creature. Which of the two
tables matters depends on whether the run is bounded by generations or by
wall-clock — and the GRQ regime is bounded by wall-clock.

## Result 3 — the false-optimum canary fires

| Arm          | Readings | Min divergence |  Mean |   Max |      Escalated |
| ------------ | -------: | -------------: | ----: | ----: | -------------: |
| `none`       |        0 |              — |     — |     — |     0/10 seeds |
| `generation` |      270 |          0.014 | 0.051 | 0.112 | **7/10 seeds** |
| `individual` |      600 |          0.000 | 0.017 | 0.167 |     0/10 seeds |

Divergence is the fraction of creature pairs the cheap ordering placed the other
way round from the exact one. `none` takes **no readings at all**: it never
approximates anything, so there is no cheap ordering to compare, and reporting a
divergence of zero for it would read as evidence of agreement where there is
none.

`generation` escalated on 7 of 10 seeds — at generations 10, 15, 35, 35, 45, 45
and 60 — every one of them on the **widening-trend** rule rather than the 0.25
threshold, which no reading came close to. That is exactly Jin's warning working
as described: the level of disagreement stayed modest while the trend gave the
drift away, and the run abandoned the cheap path for the rest of its life rather
than converging confidently on the model's error.

## What this means for production

`strategy: "none"` stays the default and stays the only strategy production
should run today, because the cheap evaluator these arms switch to does not
exist for the real lineage — #3927 and #3930 are the reason, not this table.
What lands here is the decision layer, its invariants, and the canary, so that
when a cheap evaluator does pass its gate there is something to put it behind.
