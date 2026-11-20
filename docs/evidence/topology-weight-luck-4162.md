# Topology gains versus new-edge weight-placement luck (Issue #4162)

Whether a single new forward edge helps because of its topology or because its
initial weight happened to land well. Produced by
[`scripts/topology_weight_luck_study.ts`](../../scripts/topology_weight_luck_study.ts);
the machine-readable artefact is
[`topology-weight-luck-4162.json`](topology-weight-luck-4162.json).

## Verdict

**The preregistered primary test is no-benefit.** Selecting mutations by the
median paired gain over eight weight draws (`median-paired`) against selecting
by the best single draw (`best-draw`) gives a holdout precision difference of
+0.175 with a 95% CI of [-0.0088, 0.3810]. The lower bound sits just below 0, so
by the predeclared criterion the result is no-benefit, even though the point
estimate favours `median-paired`. The secondary test against `single-draw` is a
benefit (+0.181, CI [0.079, 0.291]) but costs eight times the cheap evaluations.
`best-draw` picked 19 mutations, and 15 of them (0.79) are confirmed on the
holdout, the same precision as `single-draw` (0.78). Its mean holdout gain is
slightly negative (-0.00016), but one mutation (`r0-p6`, input-3 → output-0,
-0.0377) pulls it below zero: the median of the 19 is +0.00108 and the other 18
average about +0.0019. The mean carries no confidence interval and is not one of
the preregistered criteria, so the study does not show that best-of-eight
selection picks weight-placement luck. No default is changed.

## What was compared

- **Mutation** is one uniformly chosen new forward edge per parent creature.
- **New-edge arm** gives that edge each of eight fixed weight draws.
- **Control arm** is a matched weight-only nudge: one uniformly chosen existing
  synapse is moved by ±|w_k| in Float32, so both arms spend a matched L1 budget
  — equal to within one Float32 rounding step, not bit-identical (the artefact
  records the realised `budget` per draw; 355 of 792 differ, by at most 8.1e-7
  relative).
- **Paired gain** for draw k is the control's error minus the new-edge arm's
  error on the same records; positive means the added edge won.

```mermaid
flowchart LR
    R["10 evolution runs"] --> P["99 Float32 parents"]
    P --> M["One uniformly chosen<br/>new forward edge per parent"]
    M --> D["8 fixed new-edge weight draws<br/>+ 8 matched weight-only nudges"]
    D --> C["Cheap sample<br/>(first 50 train records)"]
    C --> S["Selection by three<br/>preregistered rules"]
    S --> T["Confirmation on full train (300)"]
    S --> H["Confirmation on untouched<br/>holdout (300)"]
```

### Predeclared design

- Parent seeds 4162–4171 (10 evolution runs, up to 10 parents each), population
  16, 15 generations, mutation rate 0.5.
- Draw seeds 41620–41627, shared by every mutation. Each draw is the production
  `Synapse.randomWeight(1)` rounded with `Math.fround`.
- The matched weight-only control nudges one uniformly chosen existing synapse
  by ±|w_k| in Float32, so both arms spend a matched L1 budget (equal to within
  one Float32 rounding step; the realised budget is recorded per draw).
- Corpus seed 4162; 300 train and 300 holdout records; the cheap sample is the
  first 50 train records.
- `CONSISTENCY_THRESHOLD` is 6 of 8 draws.
- Bootstrap: 10,000 resamples, seed 4162.
- Criteria, verbatim from the manifest: "Primary test: holdout precision of
  median-paired minus best-draw; benefit iff the paired-bootstrap 95% CI lies
  above 0, harm iff below, else no-benefit. Secondary: median-paired minus
  single-draw, same criteria. Descriptive: the holdout distribution of
  medianPairedGain. A mutation is confirmed on a corpus iff its median paired
  gain there is above 0. Selection uses the cheap sample only."
- Rules, each deciding from the cheap sample only:

| Rule            | Selects a mutation when                                                | Cost (evaluations per mutation) |
| --------------- | ---------------------------------------------------------------------- | ------------------------------- |
| `single-draw`   | the first draw's new edge beat its matched weight-only nudge           | 2                               |
| `best-draw`     | the best new-edge draw gained more than the best weight-only draw      | 16                              |
| `median-paired` | the median paired gain is above 0 and the new edge won at least 6 of 8 | 16                              |

## Results

Per rule, over 99 mutations. The holdout is data the rule never saw. The full
train set used for train confirmation includes the 50 cheap records every rule
selected on (50 of 300), so train precision is partly in-sample; holdout
precision is the unseen figure. A mutation is confirmed when its median paired
gain there is above 0.

| Rule            | Selected of 99 | Confirmed train | Precision train | Confirmed holdout | Precision holdout | Mean holdout gain of selected | Cheap selection cost (records) |
| --------------- | -------------- | --------------- | --------------- | ----------------- | ----------------- | ----------------------------- | ------------------------------ |
| `single-draw`   | 60             | 50              | 0.8333          | 47                | 0.7833            | +0.001634                     | 9,900                          |
| `best-draw`     | 19             | 15              | 0.7895          | 15                | 0.7895            | -0.000164                     | 79,200                         |
| `median-paired` | 28             | 28              | 1.0000          | 27                | 0.9643            | +0.002909                     | 79,200                         |

### Comparisons

| Test                                       | Observed | CI95              | Verdict    |
| ------------------------------------------ | -------- | ----------------- | ---------- |
| Primary: `median-paired` − `best-draw`     | +0.1748  | [-0.0088, 0.3810] | no-benefit |
| Secondary: `median-paired` − `single-draw` | +0.1810  | [0.0788, 0.2908]  | benefit    |

Both are differences in holdout precision, with 10,000 resamples and no
undefined resamples.

### Distribution of the median paired gain

Over all 99 mutations, not only the selected ones.

| Corpus  | Median of median paired gain | CI95                 | Fraction consistent (≥ 6 of 8) | Fraction luck-only |
| ------- | ---------------------------- | -------------------- | ------------------------------ | ------------------ |
| holdout | +0.000517                    | [0.000212, 0.000757] | 0.364                          | 0.081              |
| train   | +0.000548                    | [0.000368, 0.000898] | 0.343                          | 0.051              |
| cheap   | +0.000611                    | [0.000109, 0.000915] | 0.283                          | 0.040              |

Sign-consistency histogram, the number of mutations whose new edge won exactly 0
to 8 of the 8 draws:

| Wins of 8 | 0 | 1 | 2  | 3  | 4  | 5  | 6  | 7  | 8 |
| --------- | - | - | -- | -- | -- | -- | -- | -- | - |
| holdout   | 2 | 4 | 10 | 6  | 25 | 16 | 25 | 11 | 0 |
| train     | 3 | 3 | 8  | 9  | 19 | 23 | 20 | 13 | 1 |
| cheap     | 3 | 5 | 7  | 12 | 15 | 29 | 19 | 6  | 3 |

## Cost

| Phase       | Records |
| ----------- | ------- |
| Preparation | 533,100 |
| Cheap       | 84,150  |
| Train       | 504,900 |
| Holdout     | 504,900 |

Selection alone costs 9,900 cheap records for `single-draw` and 79,200 for each
of `best-draw` and `median-paired`.

## Coverage

The target was 100 parents; 99 were obtained, because one run yielded only 9
distinct parents. All 99 mutations were evaluated, with 0 failures.

## Interpretation

- On this synthetic task the median over mutations of the holdout median paired
  gain is small but positive, with a CI above 0. On average an added edge beats
  a matched weight-only nudge of the same (Float32-rounded) budget.
- Only about 36% of mutations win at least 6 of 8 draws on holdout. Most
  single-edge gains are not consistent across weight draws.
- `best-draw` selected 19 mutations, 15 of them confirmed on the holdout
  (precision 0.79, against 0.78 for `single-draw`). Their mean holdout median
  paired gain is about -0.00016, but one mutation (`r0-p6`, -0.0377) accounts
  for that: the median of the 19 is +0.00108 (all 99 mutations: +0.00052) and
  the other 18 average about +0.0019. The mean has no interval here and is not a
  preregistered criterion, so it is not evidence that best-of-eight selection
  picks luck.
- The primary test, `median-paired` against `best-draw`, is no-benefit by the
  preregistered criterion: the CI lower bound (about -0.009) is just below 0,
  even though the point estimate is +0.175.
- The secondary test against `single-draw` is a benefit (+0.181, CI [0.079,
  0.291]) but costs eight times the cheap evaluations (79,200 against 9,900
  records).
- Caveat: `median-paired` selects on the same statistic that holdout
  confirmation uses, on different data, whereas `best-draw` is a different
  statistic. That favours `median-paired` in the comparison.
- No default changed and nothing in `src/` calls the harness. No production
  adoption is justified from a synthetic corpus.

## The paper's method, pinned

### Sources

- **Abstract:** arXiv's own cs.NE RSS item of 2026-11-03, as copied in the
  public GitHub repository `ehijano/rss_fetch` at commit
  `fbd3c873cc7d24e7c8d3dd2f1cd63dc3a3a71980`, file
  `rss_data/cs.NE/2026-11-03_cs.NE.xml`.
- **Method:** the authors' public repository
  `Riccardo8888/connectome-reservoir-nulls` (MIT licence) at commit
  `994ceb97e20c9807cb777b05759d00d837914db7` (27 October 2026), file
  `paper/esn_connectome_devai.tex`, SHA-256
  `c7235bcc88f86c484a7e6f4b5353eb7c7165433b6df8760d99137cc60f454d2c`. Number
  macros are resolved from `paper/generated_numbers.tex` at the same commit.
- **arXiv is still refused:** on 2026-11-20 the abstract page and the export API
  both failed from this host
  (`curl: (56) CONNECT tunnel failed, response
  403`).
- **Caveat:** that commit predates the arXiv v1 announcement. It is the
  anonymised workshop source (NeurIPS 2026 DevAI workshop), and its abstract
  wording differs from the arXiv abstract. It is therefore not verified to be
  identical to v1.
- **Agreement checks:** the arXiv abstract and the TeX abstract both state that
  a single weight-rule draw carries about one z unit of noise. The TeX's adult
  weight-placement share of 28% to 75% matches what a later paper, arXiv
  2611.14508 ("When Does the Real Wiring Win?", its reference [18]), reports for
  2611.01213.

### Method

- **Reservoir:** an echo-state network. The recurrent matrix is fixed and
  rescaled to spectral radius 0.95; only a linear ridge readout is trained.
- **Connectomes:** adult HCP (83 regions) and dHCP neonatal (90 regions).
- **Score:** NARMA-10, scored by NRMSE. Each score is a mean over 5 reservoir
  seeds × 3 input draws.
- **Null family:** N = (R, ω), a rewiring R of the binary topology plus a weight
  rule ω that places the original weight multiset on the rewired edges. μ and σ
  are the mean and SD of the score over a null ensemble of 200 draws per family
  per graph. In the 524-infant dHCP sweep the ensemble is 100 draws per family
  per graph.
- **Nulls:** degree-preserving (Maslov–Sneppen rewiring, weight multiset
  shuffled); rank-matched (static sort by product of endpoint strengths); and
  annealed (simulated annealing to match the strength sequence).
- **Naive z:** z = (s(A) − μ) / σ.
- **Decomposition** (Proposition 1):

  ```text
  z_naive  = z_wiring + δ_ω

  z_wiring = (s̄_ω(A) − μ) / σ
  δ_ω      = (s(A) − s̄_ω(A)) / σ
  ```

  Here s̄_ω(A) is the expectation over the weight rule of the score of A's own
  wiring carrying the null's weight rule.

- **Draws:** the expectation must be estimated over many draws. One draw carries
  about one z unit of noise, enough to flip the sign of the wiring term for some
  subjects. The paper uses K ≥ 25 draws everywhere (K = 50 in the battery) and
  reports the Monte-Carlo standard error.
- **Inference:** the naive comparison uses a two-sided (k+1)/(n+1) permutation
  estimate. The wiring comparison uses a two-sample permutation test over 20,000
  label permutations. Across subjects, the mean per-subject z, its SD and a
  one-sample t-test. Benjamini–Hochberg runs over the battery's 36 tests.
- **Headline:** across 200 adult HCP graphs, weight placement accounts for 28%
  to 75% of the reported effect, depending on the null.

### How this harness maps to it

| Paper                                                            | This harness                                                                           |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Naive advantage of the real graph over its rewired nulls         | A new edge's gain over a matched weight-only nudge, read from one draw (`single-draw`) |
| Averaging A's own wiring under the weight rule over K ≥ 25 draws | Median paired gain over eight fixed draws (`median-paired`)                            |
| One draw ≈ one z unit of noise                                   | `single-draw` and `best-draw` each rest on single draws                                |
| Permutation tests and t-tests                                    | Paired bootstrap (10,000 resamples) on holdout precision                               |
| Fixed reservoir with trained readout                             | Evolved creatures; the new edge is not trained                                         |

**Departures**

- K = 8, not K ≥ 25, because the issue fixes eight draws. The Monte-Carlo error
  of the eight-draw median is not reported.
- The control is a matched Float32 weight-only nudge from the issue, not a null
  ensemble. The summary is a median, not a mean.
- Inference is a bootstrap CI on a precision difference, not a permutation test.
- The setting (evolved creatures on a synthetic regression) differs from
  connectome reservoirs.
- The higher holdout precision of `median-paired` (0.964) than `single-draw`
  (0.783) points the same way as the paper's warning about single draws. The
  setting differs, so this is neither a replication nor evidence for the paper.

## Limits

- A synthetic 4-input regression, taken from `buildStudyCorpus` of the #4160
  study; not a production corpus.
- Parents come from a short 15-generation evolution, not production creatures.
- One structural mutation type: an `AddConnection`-style new forward synapse.
  `AddNeuron` was not tested.
- arXiv itself is still unreachable from this host, so the method is pinned from
  the authors' own LaTeX source at a commit that predates v1 (see the section
  above). The harness adapts the method rather than reproducing it.
- "Scorer #588" perturbation machinery is not in this repository, so the
  perturbations are built here.
- No runs were made on private corpora; any such runs stay private.

## Reproduce

```bash
deno task topology-weight-luck-study \
  --json=docs/evidence/topology-weight-luck-4162.json --code-version=1125fce4
```

The committed artefact was regenerated at code version 1125fce4 (neatAiVersion
7.1.34, Deno 2.9.8) after the paper record was added to the manifest. Every
result section (mutations, distributions, rules, primary, secondary, cost,
coverage) is identical to the original run at 4ccb7100 (neatAiVersion 7.1.20);
only `codeVersion`, `neatAiVersion` and `paper` in the manifest changed.

---

**Up to:** [`docs/README.md`](../README.md) (topic index).
