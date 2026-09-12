# Memetic local-search budget, Stage 1 (Issue #3934)

[Jin (2011)](../comparison/REFERENCES.md#-surrogate-assisted-search-and-racing)
§5 puts surrogates inside a _memetic_ algorithm to answer one question: **who
gets refined?** Local search is a large fixed cost per individual, so spending
it on individuals that will not benefit is the dominant waste. NEAT-AI's rule is
`selectTrainingCandidates` — the top `trainPerGen` creatures by current score —
and this is the first measurement of whether that rule does anything.

Harness: [`scripts/memetic_gain_study.ts`](../../scripts/memetic_gain_study.ts).
Memetic loop:
[`scripts/lib/memeticGainStudy.ts`](../../scripts/lib/memeticGainStudy.ts).
Arithmetic:
[`scripts/lib/memeticGainAnalysis.ts`](../../scripts/lib/memeticGainAnalysis.ts).
Tests:
[`test/scripts/MemeticGainStudy.ts`](../../test/scripts/MemeticGainStudy.ts) and
[`test/scripts/MemeticGainAnalysis.ts`](../../test/scripts/MemeticGainAnalysis.ts).
Production instrumentation:
[`docs/TRAINING_GAIN_LOG.md`](../TRAINING_GAIN_LOG.md). Artefact:
[`memetic-gain-3934.json`](./memetic-gain-3934.json). Nothing under `src/`
imports the harness, and no selection behaviour changes.

## Verdict

**Stage 2 is a no-go, and the reason is not that rank says nothing — it is that
rank says something too weak to reallocate a gradient step on. What the run did
find is a larger problem one rung up: today's rule cannot spend half the budget
it is given.**

Over **10,546 real training events**, the rank a creature was selected at does
correlate with the gain its gradient step realised (ρ = 0.104, p = 0.0005 on the
unbiased arm), in the direction the issue predicted: the **incumbent has least
left to extract**. But |ρ| = 0.104 is below the 0.2 materiality floor the
harness pre-registers, and the endpoint comparison says why that floor matters:
at the same seed, today's rule and uniform-random selection reach the **same
final exact score**, and which of them is ahead flips between runs of the
identical configuration.

So there is no reallocation to make _on predicted gain_. A predictor built on
this signal would move the budget towards creatures with more headroom and
arrive at the same endpoint, which is precisely the failure mode the issue
names: _"a selector that maximises measured gain by picking creatures with the
most room to improve can systematically favour poor creatures."_

The finding that **is** worth acting on is not about gain at all. Issue #3553
trains a creature at most once per run, and a refused slot is **lost, not
reallocated** — `scheduleTraining` simply returns. Today's rule keeps choosing
the creatures at the head of the population, and with elitism those are largely
the creatures it has already trained, so:

| policy             | slots offered | steps taken | refused by #3553 |  spent |
| ------------------ | ------------: | ----------: | ---------------: | -----: |
| top (today's rule) |         7,500 |       3,769 |            3,731 | 50.3 % |
| random (baseline)  |         7,500 |       6,777 |              723 | 90.4 % |

**Today's rule converts 50.3 % of its local-search budget into gradient steps.
The random baseline converts 90.4 % of the same budget.** That is not a
statistical effect needing a materiality floor — it is an arithmetic property of
selecting by an attribute that barely changes between generations, and it is
squarely inside this issue's scope (_who is selected for local search_).

## The run

```bash
NEAT_AI_BACKPROP_ENABLED=0 deno task memetic-gain-study \
  --seeds=25 --repeats=3 --generations=25 \
  --json=docs/evidence/memetic-gain-3934.json
```

| Parameter    | Value                                                                                                                         |
| ------------ | ----------------------------------------------------------------------------------------------------------------------------- |
| Arms         | `top` (today's `selectTrainingCandidates`) and `random` (uniform over the same finite-score population), **same seed**        |
| Budget       | 3 repeats × 25 seeds × 25 generations × 4 slots = **15,000 offered slots per arm-pair** (7,500 each)                          |
| Guard        | Issue #3553 as production applies it: a creature is trained at most once per run, and a refused slot is lost                  |
| Population   | 20 creatures, elitism 2, real `Offspring.breed` and real `Mutator` operators                                                  |
| Corpus       | 600 records, deterministic non-linear regression, written to a real binary data directory                                     |
| Local search | **Real backpropagation** via `trainDir`, 2 epochs per step, TypeScript/WASM loop (the Rust trainer is absent from a checkout) |
| Score        | `-MSE` over the whole corpus, re-measured after the step; higher is better                                                    |
| Wall-clock   | The gradient step only — the harness's own exact re-score is its measuring instrument, not local search, and is not billed    |
| Host         | 7-core container, Deno 2.x                                                                                                    |

The `random` arm is not only the baseline the issue insists on. It is the **only
unbiased estimator of rank-versus-gain available**, because today's rule never
observes a gain at any rank past `trainPerGen - 1`. Both readings are published
below; the pooled one is rank-biased by the rule's own choices, and the verdict
is taken from the unbiased arm.

```mermaid
flowchart LR
    P[("score-sorted<br/>population")] -->|"top trainPerGen"| T["arm: top"]
    P -->|"uniform draw"| R["arm: random"]
    T --> Q{"#3553:<br/>trained already<br/>this run?"}
    R --> Q
    Q -->|"yes — slot lost"| X["refused<br/>(counted)"]
    Q -->|"no"| G["real gradient step<br/>(trainDir)"]
    G --> M["rank, score in, score out,<br/>wall-clock"]
    M --> C{"does rank<br/>order gain?"}
    M --> E{"does either arm<br/>reach a better endpoint?"}
    X --> B{"how much of the<br/>budget was spent?"}
```

## What the 10,546 events say

| policy | events | median gain | trimmed mean |  mean gain |  max gain | improved | training s |    gain/s | trimmed gain/s |
| ------ | -----: | ----------: | -----------: | ---------: | --------: | -------: | ---------: | --------: | -------------: |
| top    |  3,769 |  -2.570e-02 |   -4.081e-02 | -4.586e-02 | 1.923e-01 |   11.9 % |       53.6 | -3.225e+0 |      -2.870e+0 |
| random |  6,777 |  -1.372e-02 |   -2.437e-02 | -2.929e-02 | 5.480e-01 |   21.2 % |       95.8 | -2.072e+0 |      -1.724e+0 |

Read the columns in this order, because the first one is the trap:

- **`gain/s` is negative for both arms.** The issue asks for "realised gain per
  unit of training wall-clock", and the honest answer is that the _average_
  gradient step on this corpus **loses** score against the creature it trained.
  So this metric ranks the arms by which wastes less, and by it today's rule is
  **1.56× worse** than random selection (**1.66×** on the outlier-resistant
  `trimmed gain/s`, which is reported beside it so one explosive recovery cannot
  set an arm's sign on its own). It is reported because the issue asks for it,
  not because it is the number that decides anything.
- **`improved` is the column that matters.** 11.9 % of the top rule's steps
  produced a better creature; 21.2 % of random selection's did. Put the other
  way: **88.1 % of the gradient steps today's rule dispatches produce a creature
  worse than the one they trained**, and the run throws those away.
- **`events` is not the budget.** Each arm was offered 7,500 slots; the counts
  here are what survived the #3553 guard, which is the headline above.
- **`mean gain` is not a centre.** The `max gain` column shows why: a creature
  whose outputs had exploded scores a colossal negative, and one step that reins
  it in realises a gain no other event comes near. The trimmed mean (10 % each
  tail) and the median are reported beside the raw mean rather than instead of
  it — the outliers are real, so they are trimmed visibly.

### Does score-rank predict training gain?

| sample                              |     ρ |   τ-b |      p |      n | distinct ranks |
| ----------------------------------- | ----: | ----: | -----: | -----: | -------------: |
| randomly-selected events (unbiased) | 0.104 | 0.071 | 0.0005 |  6,777 |             20 |
| all events (rank-biased)            | 0.160 | 0.111 | 0.0005 | 10,546 |             20 |

**The verdict is taken from the first row only.** The pooled row reads higher
precisely because it is contaminated: every one of the top arm's events sits at
a rank below `trainPerGen`, so pooling the arms loads the best ranks with one
arm's outcomes and the rest with the other's. That is exactly why the random arm
exists.

Positive ρ means a **worse** rank (a higher index) realised a **larger** gain.
The p-value is a seeded two-sided permutation test over 2,000 shuffles, not the
asymptotic approximation — the gains are heavily tied and far from normal, which
is exactly where that approximation flatters itself. 0.0005 is the floor of
2,000 draws, so it reads as "smaller than this test can resolve" rather than as
a calibrated value, and the verdict does not turn on it.

The shape behind the coefficient is monotone and clear. These rows are the
**randomly-selected events only**, so the four quartiles are comparable with
each other rather than with a different arm:

| rank bucket | events | median gain | improved |
| ----------- | -----: | ----------: | -------: |
| 0–25 %      |  1,521 |  -1.491e-02 |   12.1 % |
| 25–50 %     |  1,585 |  -1.478e-02 |   16.3 % |
| 50–75 %     |  1,772 |  -1.483e-02 |   21.3 % |
| 75–100 %    |  1,899 |  -1.024e-02 |   32.4 % |

A creature in the bottom quartile of its population is **about 2.7 times** more
likely to benefit from a gradient step than one in the top quartile, and its
median step costs it about a third less. The issue's reasoning — "the current
leader is likely to be the individual closest to its local optimum and therefore
the one with the least left to extract" — is confirmed.

### Does it buy a better run?

| comparison                                  | value       |
| ------------------------------------------- | ----------- |
| Final exact score, `top` (mean of 75 seeds) | -1.3225e-2  |
| Final exact score, `random`                 | -1.2747e-2  |
| Paired wins, `top` vs `random`              | **40 / 75** |
| Paired mean delta (`top` − `random`)        | -4.780e-4   |
| Paired median delta                         | +2.269e-4   |

No — and more usefully, **the comparison has no stable direction to report**.
Runs of this identical configuration have given today's rule 35/75 and 43/75 as
well as the 40/75 above, with the paired median delta changing sign between
them: the winner changes between runs that differ only in the unseeded neuron
UUIDs the mutation operators mint (see the caveats). A comparison whose sign
flips between runs of the same harness cannot support a claim in either
direction.

This is the comparison the issue insists any Stage 2 selector be judged on —
"judged on **final exact score**, not on mean training gain" — and it is already
decisive before any predictor is built: **there is no measurable endpoint gap
for a gain predictor to close.**

### Is the reading stable?

| repeat | base seed | events | ρ (random arm) |      p | top wins | decision |
| -----: | --------: | -----: | -------------: | -----: | -------: | -------- |
|      1 |      3934 |  3,531 |          0.065 | 0.0020 |    15/25 | no-go    |
|      2 |      4934 |  3,483 |          0.140 | 0.0005 |    11/25 | no-go    |
|      3 |      5934 |  3,532 |          0.110 | 0.0005 |    14/25 | no-go    |

Three independent repeats, no shared seeds, same verdict each time, ρ inside
`[0.06, 0.14]` throughout — every repeat below the 0.2 floor on its own
evidence, and across every run of this configuration ρ has stayed under 0.15.
The budget-utilisation gap is present in all three.

## Caveats — what this does not show

- **Small creatures, small corpus.** The ranks and the ordering are real; the
  magnitudes are not GRQ's. A 5,317-neuron creature over a 21.2 GiB corpus could
  have a different gain distribution, and nothing here claims otherwise. What
  transfers is the _ordering_ question, which is what selection consumes.
- **The utilisation figure is scale-dependent too.** 50.3 % is what a
  20-creature population with elitism 2 and `trainPerGen` 4 produces over 25
  generations. The _mechanism_ — score-rank changes slowly, #3553 refuses a
  repeat, the slot is lost — does not depend on those numbers, but the
  percentage does. The shipped log is what measures it on a real run.
- **The TypeScript/WASM trainer, not the Rust one.** `trainDir` prefers
  `neat_ai_backpropagation` and refuses to fall back when it is enabled but
  absent; a plain checkout therefore runs the TypeScript loop, and the harness
  says so rather than measuring nothing. The same harness runs on the Rust
  trainer when it is present (`./quality.sh --next`).
- **Reproducible in distribution, not bit for bit.** The seed population's
  neuron UUIDs are named, so generation 1 of two same-seed runs agrees — but the
  mutation operators mint random UUIDs for the neurons they add, crossover
  aligns genes _by_ those UUIDs, and a memetic run amplifies the difference.
  That is why the evidence is 75 seeds across 3 repeats rather than one run
  quoted to four decimal places, and why the endpoint comparison above is
  reported as directionless rather than as a win for either arm.
- **The permutation test pools across seeds.** It shuffles 75 seeds × 25
  generations as one exchangeable sample and ignores within-run clustering, so
  its p-value is optimistic about independence. The verdict rests on the
  magnitude of ρ against a pre-registered floor, not on the p-value.
- **Two epochs per step.** Production schedules two (`#3776`), so this matches —
  but a longer local search could shift the gain distribution and is untested
  here.
- **#2382 is not modelled.** Production also skips creatures whose recent
  training attempts all regressed. Modelling it would refuse _more_ of today's
  rule's slots, not fewer, so the 50.3 % above is an upper bound on utilisation.

## What happens next

No selector is built. The Stage 2 gate — a gain predictor selecting by predicted
improvement — required Stage 1 to show gain is _usefully_ predictable, and the
measurement says it is not: a real but weak ordering with no measurable endpoint
gap behind it. The go/no-go is recorded on #3919.

The instrumentation ships anyway and off by default
([`docs/TRAINING_GAIN_LOG.md`](../TRAINING_GAIN_LOG.md)), because both numbers
that did come out of this — 88.1 % of scheduled gradient steps produce a worse
creature, and roughly half the local-search budget never becomes a gradient step
at all — are production questions it can answer on a real run, on real
creatures, without any predictor.
