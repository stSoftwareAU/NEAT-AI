# Offspring admission versus durable lineage contribution, measured (Issue #4163)

Whether an offspring being admitted to the population says anything about its
lasting contribution, and whether biasing parent choice by what recent admission
suggests helps at the same cost. Produced by
[`scripts/admission_persistence_study.ts`](../../scripts/admission_persistence_study.ts)
(library
[`scripts/lib/admissionPersistenceStudy.ts`](../../scripts/lib/admissionPersistenceStudy.ts));
the machine-readable artefact is
[`admission-persistence-4163.json`](admission-persistence-4163.json), and the
full per-species table is
[`admission-persistence-4163-species.csv`](admission-persistence-4163-species.csv).

## Question and scope

The question is a **hypothesis**, not an established improvement: does the
quality of an offspring at admission predict how much of the population descends
from it many generations later, and would weighting parents by that signal beat
choosing them uniformly?

**Provenance.** The issue cites arXiv 2611.06522. arxiv.org is still unreachable
from this host: on 2026-11-20 `curl -m 15` to `arxiv.org/abs`, `arxiv.org/pdf`,
`export.arxiv.org` and `semanticscholar.org` returned no HTTP status (`000`),
and a web fetch of `arxiv.org/html/2611.06522v1` returned
`proxy refused the connection`. The full text was instead fetched on 2026-11-20
with `gh api` from a third-party conversion in the public GitHub repository
`ZhangCurosr/zhangcursor-papers-arxiv-ai-001`, directory
`2026-11-05/From-Admission-to-Retention-Predicting-Durable-Offspring-in_7ae711e2/`.
It holds `full.md` (git blob `14a35cce37efbf87237cf3f9ff32ce9d7261fe67`, 23,221
bytes), `paper.pdf` (git blob `d9e9b9a8ab6f2eed37b5a9fa6744843f6a8f0035`,
SHA-256 `68dbd8b226d3e27b1ce32ab8bef5cf767f3e8b2e288f6677536ad43424d5e0ad`,
621,050 bytes) and `meta.json`, whose `source` is
`https://arxiv.org/pdf/2611.06522v1.pdf`. The latest commit touching `full.md`
is `e6e700264f08e4f0dc1480ff5bbb427319751d87` (2026-11-05). A sibling directory
ending `_75a97c8f` holds a byte-identical `full.md`. So the source is a
third-party text conversion of arXiv's v1 PDF, not arXiv itself. Its `images/`
directory is empty, so Figures 1 and 2 are not available; only numbers quoted in
the text are pinned here. Its title, authors and abstract match arXiv's
announcement; it gives the authors' affiliation as BAINSA – Board of AI and
Neuroscience Student Association. A copy of arXiv's own cs.NE RSS item for 5
November 2026 is also committed in `ehijano/rss_fetch`
(`rss_data/cs.NE/2026-11-05_cs.NE.xml`).

### The paper's method, pinned

Everything below is what the text states.

- **Algorithm.** Dominated Novelty Search (DNS). Competition fitness is the mean
  unnormalised Euclidean descriptor distance to the k = 3 nearest individuals of
  equal or higher fitness in archive ∪ offspring. It is +∞ when there are none,
  and averaged over fewer when fewer than k exist. The pooled set is ranked by
  it and truncated to capacity, so eviction is global and recurrent. Parents are
  sampled uniformly.
- **Capacity.** 256, 1024 and 4096, with 256 offspring per generation, so the
  offspring-to-slot ratios are 1.00, 0.25 and 0.06. Each measurement run is
  10,000 generations.
- **Variation.** Iso+LineDD with σ_iso = 0.005 and σ_line = 0.05.
- **Domains.**
  - Arm: 128 joint angles, end-effector descriptor in [0, 1]², objective
    −std(angles).
  - Omnidirectional Ant (Brax): final-position descriptor in [−30, 30]², forward
    reward removed, horizon 1000.
  - Walker 2D (Brax): MLP [16] policy, feet-contact descriptor, standard reward,
    horizon 1000.
- **Outcomes.** Entry is an offspring kept in the archive immediately after
  creation. Persistence is still being in the archive H generations later
  (individual survival). H = 1000 is the main result; H ∈ {100, 1000} is checked
  on all tasks and H = 10 on Arm only, because Brax logs every tenth generation.
  Offspring born too close to the run end are excluded (right-censoring).
- **Signals.** Twelve, in five groups (Table 1). Ancestry entropy is undefined
  at capacity 4096, so that condition has 11.

  | Group              | Cold-start | Signals                                                                       |
  | ------------------ | ---------- | ----------------------------------------------------------------------------- |
  | Lineage at birth   | yes        | depth; ancestral-fitness EWMA; ancestry entropy; competition fitness at birth |
  | Current state      | yes        | age                                                                           |
  | Archive state      | yes        | parent fitness; current competition fitness                                   |
  | Mating event       | no         | \|λ\|; compositional residual; child fitness                                  |
  | Offspring feedback | no         | curiosity; offspring survival rate                                            |

  Lineage depth is the number of reproduction steps from the founder along the
  base-parent chain.
- **Statistic.** AUC = Pr(g⁺ > g⁻) + ½Pr(g⁺ = g⁻) over parent signal values, and
  Δ = |AUC − 0.5|. There is one AUC per signal per run, and runs (not the ≈2.5 ×
  10⁷ correlated pairs) are the unit of analysis. All AUCs are measured under
  uniform selection.
- **Intervention.** Rank-softmax P(i) ∝ exp(rank(g_i)/τ) over occupied slots,
  with a most-to-least ratio of exp(1/τ) and tie-averaged ranks.
- **Seeds and sweeps (Table 3).** Measurement: 5 seeds at 256, 10 at 1024, 5 at
  4096. Fitness sweep on Omnidirectional Ant at 1024 and 4096, 4,000
  generations, uniform against τ ∈ {0.1, 0.5}, 10 seeds. Depth sweep on
  Omnidirectional Ant at 1024, 10,000 generations, ±depth with τ ∈ {0.5, 2.0},
  10 seeds. The 1024 fitness-sweep row reads "r ∈ {0.1, 0.5}" in the conversion;
  it is read here as τ, as in the 4096 row.
- **Outcome metrics.** Projected QD-score, projected coverage, mean novelty and
  maximum fitness.

### The paper's findings, pinned

- At capacity 1024 and H = 1000, several cold-start signals reverse direction
  between entry and persistence on all three tasks. Shallower lineage depth is
  associated with entry and deeper with persistence.
- Lineage-depth persistence AUC rises monotonically with capacity on all three
  tasks, while entry AUC falls below chance.
- On Omnidirectional Ant, lineage-depth persistence discrimination rises from
  0.097 to 0.198 while the lineage-depth interquartile range drops from ≈94 to
  ≈16.
- Parent-fitness persistence Δ on Omnidirectional Ant rises from 0.027 to 0.138
  (capacity 256 to 4096).
- Fitness bias at τ = 0.5 gives QD-score 4.04 × 10⁶ against 4.02 × 10⁶ for
  uniform at capacity 4096 over 10 seeds. τ = 0.1 is −64.4% at 4096 and −43.6%
  at 1024. The loss comes through coverage (0.9999 to 0.517) and mean novelty
  (0.848 to 0.544), with maximum fitness essentially unchanged.
- Depth sweep at capacity 1024: τ = 0.5 gives 3.130 × 10⁶ (coverage 0.767), τ =
  2.0 gives 3.112 × 10⁶, inverted gives 3.125 × 10⁶ (coverage 0.769), and
  uniform gives 3.156 × 10⁶ (coverage 0.773). Every difference is within the
  between-seed spread.
- The authors limit the claims to predictive association, DNS, one variation
  operator and three domains.

### How this harness relates to the paper

The harness is **not** a reproduction of the paper, and it was built before the
method was read.

| Aspect         | Paper                                                                                                             | Harness                                                                                                                                                                                           |
| -------------- | ----------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Search         | DNS archive with global re-ranking, on robotics QD tasks                                                          | Mutation-only mu + lambda truncation by train MSE on `synthetic-quadrant-v1` (N = 12, lambda = 12, 1100 generations)                                                                              |
| Persistence    | Individual survival only                                                                                          | Individual survival and descendant contribution                                                                                                                                                   |
| Analysis       | Per-run AUC of parent signal values                                                                               | Admission and persistence rates by rank                                                                                                                                                           |
| Signal         | Twelve signals, including lineage depth as a selection signal                                                     | Calibration MSE rank, nearest to the paper's archive-state "parent fitness" baseline; lineage depth is not used as a selection signal                                                             |
| Bias           | Rank-softmax with ratio exp(1/τ); τ = 0.5 (ratio e² ≈ 7.39) and τ = 2.0 (ratio e^0.5 ≈ 1.65) both matched uniform | Weight `oddsCap ** (1 - r)`, r the tie-averaged rank scaled to [0, 1] (`parentWeights` in `scripts/lib/admissionPersistenceStudy.ts`): ratio 2, that is τ = 1/ln 2 ≈ 1.44 in the paper's notation |
| Seeds          | 5 to 10 per cell                                                                                                  | 20 paired                                                                                                                                                                                         |
| Success metric | Projected QD-score and coverage                                                                                   | Holdout MSE plus a diversity ratio                                                                                                                                                                |

The harness's rank-softmax equivalence assumes the paper scales ranks to [0, 1].
That scaling is inferred from the stated ratio exp(1/τ), which the text does not
spell out otherwise. On that reading the harness bias sits between the paper's τ
= 2.0 and τ = 0.5.

## Reproduce

```bash
deno task admission-persistence-study \
  --json=docs/evidence/admission-persistence-4163.json \
  --species-csv=docs/evidence/admission-persistence-4163-species.csv
```

Each seed runs in its own child process. The 20 predeclared seeds are the
default.

### Manifest

| Item         | Value                                         |
| ------------ | --------------------------------------------- |
| Code commit  | `e131ebfe2df4f35e18ade97c2dc03506c6f34d00`    |
| Dirty tree   | `false`                                       |
| NEAT-AI      | 7.1.22                                        |
| NEAT-AI-core | `1d44889e405e4e0cfb553321b44cc39e7d771f5f`    |
| Deno         | 2.9.8 (V8 15.0.245.2-rusty, TypeScript 6.0.3) |
| Corpus       | `synthetic-quadrant-v1`                       |
| Seeds        | 4163 to 4182 (20)                             |
| Settings     | see the table below                           |

| Setting                  | Value         |
| ------------------------ | ------------- |
| Records per split        | 100           |
| Population (N, mu)       | 12            |
| Offspring per generation | 12 (lambda)   |
| Generations              | 1100          |
| Horizons (generations)   | 10, 100, 1000 |
| Odds cap                 | 2             |
| Diversity probe cadence  | every 50      |

## Predeclared design

The settings, arms and thresholds are constants in code, and the run was made
from a clean tree at the commit above. They were fixed before the run, and no
criterion was changed afterwards. Later commits changed only console labels,
provenance capture timing, command-line argument validation and comments in
`scripts/`, not the measured loop, so rerunning at the head gives the same
numbers.

- **Controls:** uniform parent selection is the control. The `biased` arm is the
  treatment: it weights parents by the rank of their calibration mean squared
  error (MSE, [glossary](../GLOSSARY.md#-acronyms)) only, with best-to-worst
  odds capped at 2:1.
- **Seeds and sample size:** 20 seeds, numbered 4163 to 4182, each run in both
  arms with the same starting population, so the comparison is paired.
- **Compute limits:** 1100 generations per run. Each arm is charged 52,848,000
  records in total (2,642,400 per seed, 264,240 evaluations, 264,000 offspring),
  and the two arms are identical on every one of those counts.
- **Success criteria** (`SUCCESS_CRITERIA`, reused from Issue #4155). The
  treatment **benefits** only if all three hold against the control:
  1. The upper bound of the bootstrap 95% confidence interval (CI) of the mean
     paired holdout-MSE difference is below 0.
  2. It wins on at least 70% of seeds.
  3. The median behavioural-diversity ratio is at least 0.8.
- **Failure criterion:** it is **harmful** if the CI lower bound is above 0.
  Otherwise the verdict is **no-benefit**.

### Definitions

Taken from the artefact's `manifest.definitions`.

| Term                    | Definition                                                                                                                    |
| ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Initial acceptance      | An offspring is admitted when it is among the N survivors of the birth selection (train MSE, ties to the older individual).   |
| Individual survival     | The individual itself is in the population exactly h generations after its birth.                                             |
| Descendant contribution | At least one member of the population h generations after its birth is the individual or descends from it.                    |
| Right-censoring         | An individual born after G - h has no h-generation reading. It is excluded from that horizon's rates and counted as censored. |
| Turnover                | Admitted offspring in a generation divided by N.                                                                              |
| Lineage depth           | 0 for a seed, parent depth + 1 for an offspring.                                                                              |
| Species / team          | Both groupings are reported: the Genus species key (`Species.calculateKey`) at birth, and the founder clade.                  |

### Leakage and calibration policy

- _Train_ drives admission (the birth selection).
- _Calibration_ drives the parent bias only.
- _Holdout_ is for reporting only. It is read once at the final generation and
  never by selection, mutation or parent weighting, and it is never charged.

### Cost policy

`recordsScored` charges the train and calibration records of every evaluation,
seeds included. Holdout records (24,000 per arm in total) are reported
separately and never charged. The behavioural-diversity probe activations
(353,280 per arm in total) are counted as `diagnosticRecords` and also never
charged. No wall-clock time is recorded, by either script or in the artefact.
Cost is counted in records only.

### One generation

```mermaid
flowchart LR
    W["Draw lambda parents<br/>by arm weights"] --> M["Mutate<br/>(parents cloned,<br/>never modified)"]
    M --> E["Evaluate train +<br/>calibration (charged)"]
    E --> T["mu + lambda truncation<br/>by train MSE<br/>= admission"]
    T --> A["Ancestor walk updates<br/>survival and descendants<br/>at horizons"]
    A --> W
    T -.-> H["Holdout reported<br/>(never read back)"]
```

## Results

Twenty seeds ran to completion in both arms (coverage 20/20 paired). Every
number is in the artefact's `summary`, `comparisons` and `runs[]` blocks.

### (a) Observation: admission and persistence

Pooled over the 20 seeds. "Given admitted" restricts to offspring admitted at
birth. Individuals born too late to be read at a horizon are censored there.

| Arm       | Horizon | Eligible | Censored | Admission rate | Survival given admitted | KM survival given admitted | Contribution given admitted | Per-seed median (min, max) |
| --------- | ------- | -------- | -------- | -------------- | ----------------------- | -------------------------- | --------------------------- | -------------------------- |
| `uniform` | 10      | 261,600  | 2,400    | 0.201          | 0.0995                  | 0.108                      | 0.273                       | 0.275 (0.218, 0.384)       |
| `uniform` | 100     | 240,000  | 24,000   | 0.201          | 0                       | 0                          | 0.111                       | 0.113 (0.104, 0.118)       |
| `uniform` | 1000    | 24,000   | 240,000  | 0.201          | 0                       | 0                          | 0.109                       | 0.109 (0.0825, 0.134)      |
| `biased`  | 10      | 261,600  | 2,400    | 0.200          | 0.100                   | 0.107                      | 0.274                       | 0.282 (0.189, 0.336)       |
| `biased`  | 100     | 240,000  | 24,000   | 0.200          | 0                       | 0                          | 0.115                       | 0.115 (0.102, 0.128)       |
| `biased`  | 1000    | 24,000   | 240,000  | 0.200          | 0                       | 0                          | 0.112                       | 0.112 (0.0940, 0.137)      |

The Kaplan-Meier (KM) column is the unweighted mean over seeds of each seed's
estimate of the survival curve, which is derived from `runs[]` rather than the
command-line `summary`. Admitted offspring were 52,985 of 264,000 in the
`uniform` arm and 52,826 of 264,000 in the `biased` arm.

**Individual survival is 0 at 100 and 1000 generations in both arms.** No
individual outlives a population that turns over about a fifth of its members
every generation. Durability therefore shows only as **descendant
contribution**: about 11% of admitted offspring still have a descendant (or are
themselves present) 100 generations on, and about 11% again at 1000 generations
(0.111 and 0.109 uniform; 0.115 and 0.112 biased).

#### Admission-rank quartiles

Admitted offspring are split into quartiles by admission rank (0 is best).
Pooled contribution rate by quartile, derived from `runs[]` as the per-seed
rates weighted by the number of eligible offspring:

| Arm       | Horizon | Quartile 0 | Quartile 1 | Quartile 2 | Quartile 3 |
| --------- | ------- | ---------- | ---------- | ---------- | ---------- |
| `uniform` | 10      | 0.623      | 0.209      | 0.0811     | 0.0313     |
| `uniform` | 100     | 0.271      | 0.0692     | 0.0309     | 0.0122     |
| `uniform` | 1000    | 0.261      | 0.0714     | 0.0353     | 0.0149     |
| `biased`  | 10      | 0.614      | 0.209      | 0.0785     | 0.0311     |
| `biased`  | 100     | 0.270      | 0.0710     | 0.0291     | 0.0151     |
| `biased`  | 1000    | 0.273      | 0.0657     | 0.0317     | 0.0118     |

Admission rank is strongly associated with later contribution: the best quartile
contributes roughly 20 times as often as the worst at 100 and 1000 generations.
This is an association within the admitted set, and the same in both arms.

#### Population dynamics

Per seed, mean over the 20 seeds, with the range in brackets (derived from
`runs[]`).

| Quantity                        | `uniform`            | `biased`             |
| ------------------------------- | -------------------- | -------------------- |
| Mean turnover                   | 0.201 (0.131, 0.263) | 0.200 (0.152, 0.294) |
| Final mean lineage depth        | 294 (199, 369)       | 301 (222, 424)       |
| Final maximum lineage depth     | 297 (204, 374)       | 304 (224, 426)       |
| Founder clades alive at the end | 1 (1, 1)             | 1 (1, 1)             |
| Species count at the end        | 2.35 (1, 5)          | 2.20 (1, 4)          |

Every run starts with 12 founder clades (one per seed individual) and ends with
exactly one, so after 1100 generations every population descends from a single
founder. The founder-clade breakdown is reported as a count only. A per-founder
table (`byFounder`, offspring, admitted and contributors) is in
`runs[].persistence.horizons[]`.

#### Persistence per Genus species

Each individual records at birth the species key that `Genus` groups by
(`Species.calculateKey`: hidden-neuron count bucket, connectivity bucket and
squash mix). The key depends only on architecture, so the same key names the
same species in every seed, and rows are pooled across seeds by key. The JSON
artefact holds a digest per arm and horizon in
`summary.<arm>.horizons[].bySpecies`. The full table, one row per species with
at least one admitted offspring, is the CSV. The spread columns cover species
with at least 30 admitted eligible offspring.

| Arm     | Horizon | Species | With an admission | Never admitted (offspring) | In 2+ seeds | Species in spread | Contribution given admitted: min / median / max |
| ------- | ------- | ------- | ----------------- | -------------------------- | ----------- | ----------------- | ----------------------------------------------- |
| uniform | 100     | 9,969   | 2,748             | 7,221 (12,527)             | 252         | 338               | 0 / 0.130 / 0.333                               |
| uniform | 1000    | 1,253   | 497               | 756 (1,261)                | 171         | 59                | 0 / 0.125 / 0.333                               |
| biased  | 100     | 10,382  | 2,844             | 7,538 (12,474)             | 176         | 368               | 0 / 0.131 / 0.367                               |
| biased  | 1000    | 1,257   | 524               | 733 (1,078)                | 140         | 68                | 0 / 0.134 / 0.275                               |

Individual survival given admission is 0 in every species at 100 and 1000
generations, as it is pooled. Speciation by architecture bucket splits the
offspring into many small species: most are seen in one seed only, and most
never have an offspring admitted. The median contribution rate per species
(0.125 to 0.134) sits slightly above the pooled rate (0.109 to 0.115), and the
spread across species is wide. It is not tested against chance, so it does not
show that any species persists better than another. The final population holds
only 1 to 5 species (see the table above): architecture changes under mutation,
so species turn over faster than founder clades do.

### (b) Comparison: biased against uniform

Final holdout MSE, `biased` minus `uniform`, paired by seed (n = 20); negative
is better.

| Metric              | Mean diff | Median diff | CI95                 | Wins  | Losses | Diversity ratio | Verdict      |
| ------------------- | --------- | ----------- | -------------------- | ----- | ------ | --------------- | ------------ |
| `bestHoldout`       | -4.58e-4  | -1.37e-4    | [-1.08e-3, +1.38e-4] | 11/20 | 9/20   | x0.912          | `no-benefit` |
| `populationHoldout` | -4.75e-4  | -1.06e-4    | [-1.11e-3, +1.29e-4] | 11/20 | 9/20   | x0.912          | `no-benefit` |

CI95 is the bootstrap 95% confidence interval of the mean paired difference.
Persistence across seeds (part a) is reported only as pooled rates with the
per-seed median, minimum and maximum; there is no interval for those. Only the
paired holdout comparisons carry a bootstrap 95% CI.

Records-to-target was not measured. The harness declares no target threshold, so
there is no records-to-target comparison, and the artefact records
`recordsToTarget` as `"not-measured"` rather than as zero seeds reaching a
target. The absence of a comparison says nothing about whether either arm would
have reached one.

### Coverage and failures

- Coverage is 20/20 paired: 20 seeds requested, 20 completed in each arm, 20
  paired.
- `failuresRun` is empty (no seed failed to run).
- The per-run `failures` count is 0 in all 40 runs.

## Findings

**What "admission" means here.** Admission is survival of this harness's own
mutation-only mu + lambda truncation by train MSE. It is a stand-in for, not a
reproduction of, NEAT-AI's production selection and speciation pipeline
(`src/NEAT/`). The result describes the mechanism on a synthetic task, not
NEAT-AI's production admission.

**Censoring.** The 1000-generation rates cover only offspring born in
generations 1 to 100, because all later births are right-censored. They describe
the early part of each run. The 100-generation rates cover births in generations
1 to 1000.

This is a **negative result**. The capped 2:1 bias gives no benefit by the
predeclared criteria. Both verdicts are `no-benefit`: the CI on the mean paired
difference spans zero for both holdout measures, the biased arm wins 11 of 20
seeds against the required 14, and the 0.912 diversity ratio clears its 0.8
floor but is not enough on its own.

- Admission and durability are linked in this task. Better-ranked admissions
  contribute descendants much more often, but individual survival is 0 at 100
  and 1000 generations, and only about 11% of admitted offspring leave a
  descendant at either horizon.
- Weighting parents by calibration rank did not change those rates in any way
  the criteria can distinguish from seed-to-seed variation.

These are **predictive associations from one synthetic task**. They do not
establish that admission, rank or lineage membership has causal value.

## Deviations

- The first 20-seed attempt ran the V8 JavaScript engine's heap out of memory at
  seed 12, because the heap grew across seeds inside one process. The CLI was
  changed to run each seed in its own process and the full run was repeated. The
  11 seeds the first attempt completed printed identical per-seed numbers, so
  the change did not alter results.
- The per-species breakdown was added after the first reported run, and the
  predeclared 20 seeds were run again from a clean tree at the commit above.
  Recording the species key reads the creature and draws no random numbers, so
  every per-seed number and both paired comparisons are identical to the first
  reported run (commit `308ae6ee`).

## Preparation and search costs

Every run made for this study besides the reported one, so that all costs are
counted:

- A 1-seed, 1100-generation smoke run of both arms.
- A 2-seed, 60-generation smoke run of the per-seed child-process mode.
- The aborted first 20-seed attempt: 11 seeds completed and part of the 12th ran
  before the heap ran out (see Deviations).
- The first complete 20-seed run (commit `308ae6ee`), before the per-species
  breakdown.
- A 1-seed, 1100-generation run used to estimate how long the re-run would take.
- A 20-seed run with the per-species breakdown that kept every species row per
  run, which made a 38 MB artefact. It was discarded and the output was changed
  to the digest and the CSV, then run again for the reported result.

The settings (1100 generations, N = 12, lambda = 12, 100 records per split) were
chosen before any run and not tuned on results. Unit-test runs are synthetic and
tiny and are not counted as study cost.

## Maintenance decision

Nothing under `src/` changed. The bias exists only inside the opt-in harness, so
there is no optional production code to remove. The harness is kept as the
reproducible command for this result. The commit hash and dirty flag are read by
the shared helper `scripts/lib/gitProvenance.ts`.

## What this does not say

- **Nothing about production-scale creatures.** This is a synthetic task with
  small creatures and no private corpus.
- **Nothing that confirms the paper.** The full text was read and its method is
  pinned above. This study's `no-benefit` verdict for a 2:1-capped bias (τ ≈
  1.44) points the same way as the paper's moderate-bias null. But the task,
  selection loop, signal and analysis differ, so it is neither a replication nor
  evidence for the paper.
- **Nothing that changes ordinary behaviour.** Interfaces and defaults are
  untouched.

---

**Up to:** [`docs/README.md`](../README.md) (topic index).
