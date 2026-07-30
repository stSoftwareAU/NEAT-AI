# Option audit — slice A: core evolution & training top-level options

Slice A of the [#3505](https://github.com/stSoftwareAU/NEAT-AI/issues/3505)
option-removal audit (Issue #3519). It classifies the **46 non-`discovery*`
top-level scalar and flag options** declared in
[`src/config/NeatArguments.ts`](../src/config/NeatArguments.ts) against real
consumer usage.

Out of scope here: `discovery*` keys (slice B, #3520), all nested config objects
(slices C–F), and `fitnessSampleRate` (already removed by #3502).

The companion doc [`OPTION_USAGE_AUDIT.md`](OPTION_USAGE_AUDIT.md) describes the
scan harness and the search traps this slice had to work around.

## Result

| Verdict                       | Count |
| ----------------------------- | ----: |
| `IN USE`                      |    24 |
| `KEEP (load-bearing default)` |    18 |
| `QUALIFIES`                   |     4 |
| **Total**                     |    46 |

Four options qualify for removal, filed as three removal issues: #3552
(`maxConns` + `maximumNumberOfNodes`, which share one code path), #3553
(`enableRepetitiveTraining`) and #3554 (`dnaSharingMode`).

## Method

Consumers were confirmed from `deno.json`: `stSoftwareAU/GRQ` pins
`jsr:@stsoftware/neat-ai@6.0.0` and `stSoftwareAU/NEAT-AI-Examples` pins
`@5.9.43`.

Each key was resolved twice, against fresh clones and against the code-search
index:

```bash
# Local pass — primary evidence, complete and unmetered.
git -C GRQ                grep -n -E "(^|[^A-Za-z0-9_])<key>[[:space:]]*[:=]" -- '*.ts' '*.js' '*.json' '*.sh'
git -C NEAT-AI-Examples   grep -n -E "(^|[^A-Za-z0-9_])<key>[[:space:]]*[:=]" -- '*.ts' '*.js' '*.json' '*.sh'

# Cross-check — per-repo only, never a bare --owner.
gh search code "<key>" --repo stSoftwareAU/GRQ --limit 20
gh search code "<key>" --repo stSoftwareAU/NEAT-AI-Examples --limit 20
```

A key with no local hit was re-checked as a plain substring across the whole
clone (docs included) before any `QUALIFIES` verdict, then cross-checked with
code search. `QUALIFIES` was only awarded where all three passes were empty
**and** the default was read to be inert.

### Two search faults this slice hit and corrected

Both are worth recording, because each one silently manufactures false
`QUALIFIES` verdicts:

1. **`ripgrep` is not on the non-interactive `PATH` here** — it resolves only as
   a shell function. The first sweep paired `rg` with `2>/dev/null`, so the
   exit-127 "command not found" was swallowed and **every one of the 46 keys
   read as unused**, including `populationSize`. Fixed by switching to
   `git grep` (the tool the harness itself auto-detects) and never suppressing
   stderr. This is the [fail-loud rule](../AGENTS.md) in miniature: absence of a
   hit is not evidence of absence when the search never ran.
2. **A bare `gh search code --owner stSoftwareAU` saturates its result window**
   with NEAT-AI's own hits, so consumer hits fall off the end. Every query in
   this slice is `--repo`-scoped.

### Controls

The `populationSize` positive control was run through **both** search paths
before any verdict was recorded, and both were re-run after the `rg` fault was
fixed:

- `git grep` — hits in both clones (`GRQ/src/Learn.ts:436`,
  `NEAT-AI-Examples/adaptive_mutation/adaptive_mutation.ts:408`).
- `gh search code --repo` — 20 hits in each consumer.
- `scripts/audit-option-usage.ts --controls-only` — passed, which also confirms
  the negative control (`dnaSharingMode` reported not set).

## `QUALIFIES` — 4 keys, 3 removal issues

| Key                        | Default                   | Issue | Why the default is inert                                                                                                                                            |
| -------------------------- | ------------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `maxConns`                 | `Number.MAX_SAFE_INTEGER` | #3552 | Only reader is `Mutator.ts` `creature.synapses.length >= config.maxConns`, which can never be true. The adjacent `maxSynapses` bound does the real capping.         |
| `maximumNumberOfNodes`     | `Number.MAX_SAFE_INTEGER` | #3552 | Only reader is `Mutator.ts` `creature.neurons.length < config.maximumNumberOfNodes`, which is always true.                                                          |
| `enableRepetitiveTraining` | `false`                   | #3553 | Only reader is `NeatScheduling.ts`; with the flag off the branch always returns, so deleting the flag preserves behaviour exactly.                                  |
| `dnaSharingMode`           | `"default"`               | #3554 | `DEFAULT_DNA_SHARING_PRESET` is defined to equal the per-knob defaults already applied in `createNeatConfig()` — asserted by `test/transfer/KnobTuningStrategy.ts`. |

Each removal issue carries a reviewer caveat, because none of the three is a
pure dead-knob deletion: `maxConns` / `maximumNumberOfNodes` are functional when
set and NEAT-AI's own tests set them; `enableRepetitiveTraining` is set `true`
by three internal tests that would need reworking; and `dnaSharingMode` is the
read-side of an exported strategy API and the audit harness's own negative
control.

`dnaSharingMode` is the one that needs a human's eye at review. It is inert
today, and the #2496 bake-off
([`dna-sharing-bake-off-results.md`](dna-sharing-bake-off-results.md)) measured
`KnobTuningStrategy("aggressive")` at **zero lift** and deliberately does not
flip the knob. But it is also the read-side of an **exported** strategy API, so
its removal issue has to take `KnobTuningStrategy`,
`AGGRESSIVE_DNA_SHARING_PRESET`, and the preset lookup with it. That is a
feature deletion, not a dead-knob deletion.

## `KEEP (load-bearing default)` — 18 keys

Nobody sets these, but the default drives live behaviour, so the knob stays.

| Key                                       | Default                 | What the default drives                                                    |
| ----------------------------------------- | ----------------------- | -------------------------------------------------------------------------- |
| `dataSetPartitionBreak`                   | `2000`                  | Real dataset partition size.                                               |
| `debug`                                   | `\|\| getGlobalDebug()` | ORs in a live global switch; also the export-validation diagnostics hatch. |
| `maxCRISPRsPerGeneration`                 | `1`                     | Caps CRISPR applications per generation — and GRQ _does_ set `CRISPRs`.    |
| `maxDedupRetries`                         | `16`                    | Dedup retry budget.                                                        |
| `trainingTaskTimeoutMinutes`              | `5` min                 | Per-task wall-clock cap (#3053); `0` would disable it.                     |
| `skipTrainingAfterConsecutiveRegressions` | `2`                     | Regression bypass fires after two regressions (#2382).                     |
| `subnetworkIndexSize`                     | `50_000`                | Sizes the shared subnetwork LRU index (#2531).                             |
| `trainingBatchSize`                       | `100`                   | Live batch size.                                                           |
| `disableRandomSamples`                    | `feedbackLoop === true` | Derived from `feedbackLoop`, which **is** in use in NEAT-AI-Examples.      |
| `maximumBiasAdjustmentScale`              | `1`                     | A ±1 per-iteration bias clamp, not an identity multiplier.                 |
| `maximumWeightAdjustmentScale`            | `1`                     | A ±1 per-iteration weight clamp.                                           |
| `globalBreedingRate`                      | `rng.random()`          | Randomised per run — removing it would fix a currently-varying behaviour.  |
| `diversityBreedingRate`                   | preset                  | Supplied by the DNA-sharing preset.                                        |
| `geneticCompatibilityThreshold`           | preset (`0.3`)          | Nine live readers.                                                         |
| `interSpeciesCrossoverThreshold`          | preset (`0.1`)          | Selects the input-weight crossover path.                                   |
| `syntheticAlignmentThreshold`             | `0.2`                   | Grafting alignment fallback — an AGENTS.md documented invariant.           |
| `allowPoolBorrowing`                      | `!== false` → `true`    | Heavy-pool borrowing is **on** by default (#2329).                         |
| `tolerateCorruptParents`                  | `!== false` → `true`    | Corrupt-parent tolerance is **on** by default.                             |

## `IN USE` — 24 keys

| Key                               | Evidence                                                                                    |
| --------------------------------- | ------------------------------------------------------------------------------------------- |
| `populationSize`                  | `GRQ/src/Learn.ts:436`; `NEAT-AI-Examples/adaptive_mutation/adaptive_mutation.ts:408`       |
| `costName`                        | `GRQ/src/Learn.ts:162`; `NEAT-AI-Examples/mnist_classification/exploration_campaign.ts:526` |
| `creativeThinkingConnectionCount` | `GRQ/src/Learn.ts:430`                                                                      |
| `creatures`                       | `GRQ/src/Learn.ts:428`                                                                      |
| `CRISPRs`                         | `GRQ/src/Learn.ts:429`                                                                      |
| `customCost`                      | `GRQ/src/fx/EvolveApp.ts:374`                                                               |
| `feedbackLoop`                    | `NEAT-AI-Examples/crispr_injection/crispr_injection.ts` (+21 more files)                    |
| `focusList`                       | `GRQ/src/Learn.ts:440`                                                                      |
| `focusRate`                       | `GRQ/src/Learn.ts:441`                                                                      |
| `costOfGrowth`                    | `GRQ/src/Learn.ts:437`; `NEAT-AI-Examples/adaptive_mutation/adaptive_mutation.ts:420`       |
| `elitism`                         | `GRQ/src/Learn.ts:545`                                                                      |
| `timeoutMinutes`                  | `GRQ/src/Learn.ts:432`; `NEAT-AI-Examples/adaptive_mutation/adaptive_mutation.ts:417`       |
| `trainPerGen`                     | `GRQ/src/Learn.ts:442`                                                                      |
| `mutationAmount`                  | `GRQ/src/Learn.ts:548`; `NEAT-AI-Examples/adaptive_mutation/adaptive_mutation.ts:421`       |
| `mutationRate`                    | `GRQ/src/Learn.ts:551`; `NEAT-AI-Examples/adaptive_mutation/adaptive_mutation.ts:420`       |
| `threads`                         | `GRQ/src/Learn.ts:438`; `NEAT-AI-Examples/adaptive_mutation/adaptive_mutation.ts:425`       |
| `heavyTaskWorkerCount`            | `GRQ/src/Learn.ts:110`                                                                      |
| `selection`                       | `GRQ/src/Learn.ts:542`                                                                      |
| `iterations`                      | `NEAT-AI-Examples/adaptive_mutation/adaptive_mutation.ts:410`                               |
| `verbose`                         | `GRQ/src/Learn.ts:439`; `NEAT-AI-Examples/adaptive_mutation/adaptive_mutation.ts:423`       |
| `log`                             | `GRQ/src/Learn.ts:434`; `NEAT-AI-Examples/adaptive_mutation/adaptive_mutation.ts:424`       |
| `trainingSampleRate`              | `GRQ/src/Learn.ts:444`; `NEAT-AI-Examples/mnist_classification/exploration_campaign.ts:103` |
| `targetError`                     | `GRQ/src/Learn.ts:433`; `NEAT-AI-Examples/adaptive_mutation/adaptive_mutation.ts:411`       |
| `sparseRatio`                     | `GRQ/src/Learn.ts:445`                                                                      |

Of the injection points the slice was told to hold to a higher bar, all but
`debug` came back `IN USE` on their own evidence: `costName`, `customCost`,
`selection`, `feedbackLoop`, `focusList`, `creatures`, and `CRISPRs`. `debug` is
`KEEP`, not a removal candidate.

## Dedup

Checked #3446–#3449 (deprecated-api) and #3509–#3512 (dead-code sweep): none
touches a slice-A option key, so no existing issue absorbs these findings. An
open-issue search for each `QUALIFIES` key found no prior removal issue.
