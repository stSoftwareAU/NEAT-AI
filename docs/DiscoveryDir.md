# DiscoveryDir Integration Guide

The `Creature.discoveryDir()` helper schedules targeted discovery work over a
sampled dataset and returns the best performing candidate creature together with
a human-friendly summary. This guide explains how to prepare data, invoke
discovery, and fold improvements back into your controller workflow without
referencing private infrastructure.

## Prerequisites

- Deno 2.x with `--allow-read`, `--allow-write`, `--allow-env`, and
  `--allow-ffi` permissions enabled for the discovery process.
- The [NEAT-AI-Discovery](https://github.com/stSoftwareAU/NEAT-AI-Discovery)
  Rust module compiled for the host platform. Install it via
  `cargo build --release` and either:
  - copy the resulting `libneat_ai_discovery` artefact into `~/.cargo/lib`, or
  - set `NEAT_AI_DISCOVERY_LIB_PATH=/absolute/path/to/libneat_ai_discovery.*`.
- Discovery-aware builds of `NEAT-AI`. Use `isRustDiscoveryEnabled()` to assert
  that the Rust module is available before scheduling work:

```18:38:src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts
export function isRustDiscoveryEnabled(): boolean {
  try {
    return isRustLibraryAvailable();
  } catch {
    // FFI not allowed or library not available
    return false;
  }
}
```

If `isRustDiscoveryEnabled()` returns `false`, skip the discovery pass or
surface a configuration error to the operator.

When the analyser is available, neuron discovery currently explores industry
standard squashes including ReLU, GELU, ELU, SELU, Softplus, LOGISTIC (sigmoid),
and TANH. There is no TypeScript fallback path; without the Rust module the
discovery phase is skipped.

## Data Layout Expectations

Discovery operates on two directories that can be shared across nodes:

1. **Creature samples** – a directory of JSON exports produced by
   `Creature.toJSON()` with a `score` tag that reflects each candidate’s
   baseline performance.
2. **Discovery dataset** – a directory containing the sampled training data used
   exclusively for the discovery phase. The runner never mutates these inputs.

The stock discovery scanner demonstrates how to select the top scored candidate
safely:

```ts
const result = await best.creature.discoveryDir(cliArgs.dataDir, options);
console.info(result);

if (result.improvement) {
  const exported = result.improvement.creature;
  addTag(exported, "score", `${result.improvement.score}`);
  addTag(exported, "error", `${result.improvement.error}`);
  addTag(exported, "Discovery", `${result.improvement.message}`);
  await saveCreature(cliArgs.targetFile, exported);
  console.info(`Discovery saved to ${cliArgs.targetFile}`);
} else {
  console.info("Discovery completed with no improvement this round.");
}
```

Key practices drawn from production usage:

- **Assert CLI inputs** – convert and validate numeric flags up-front to fail
  fast on misconfigured jobs.
- **Ignore unscored samples** – skip JSON files that lack a numeric `score` tag
  so incomplete uploads never displace a validated creature.
- **Safe writes** – persist improved creatures via a temporary file
  (`*.working`) followed by an atomic rename to avoid zero-length files if the
  host crashes mid-write.

## Operating the Discovery Loop

A long-running controller typically repeats the following pattern while a
discovery window is open:

1. Fetch the latest samples from your exchange point (for example, `rsync` or
   S3). At example.com we run `model_fetch.sh example-sampler` to mirror the
   newest JSON files.
2. Ensure liveness markers are updated (e.g. touching `.run.pid` each iteration)
   so orchestration can detect stalled workers.
3. Launch the discovery scan with the desired overrides:

   ```bash
   deno run \
     --v8-flags=--max-old-space-size=8192 \
     --allow-read --allow-write --allow-net --allow-ffi --allow-env \
     src/Discovery/Scan.ts \
     --directory="/srv/example.com/samples" \
     --dataDir="/srv/example.com/discovery-data" \
     --targetFile="/srv/example.com/outbox/${HOSTNAME}-${USER}.json" \
    --discoveryRecordTimeOutMinutes=15 \
     --discoveryBatchSize=25 \
     --discoverySampleRate=0.01
   ```

4. On success, extract the `Discovery` tag from the returned JSON and include it
   in audit logs or commit messages before promoting the improved creature
   through staging.
5. Exit the loop early if the orchestration layer signals (for example via a
   `.spot_termination` sentinel) that the worker must drain.

The reference `run.sh` worker script includes lightweight guards that you can
adapt:

- Guard dependencies with `command -v` to provide actionable error messages when
  `deno` or `jq` is missing.
- Validate CLI flags (`--timeout`, `--discoverySampleRate`, and friends) before
  running any side-effects.
- Touch `.run.pid` to acknowledge the worker is still alive between iterations.

## Memory Management

- Tune `discoveryRustFlushRecords` to control how many discovery samples are
  buffered in memory before the Rust recorder is flushed. Lowering the value
  (for example `--discoveryRustFlushRecords=2048`) reduces V8 heap growth at the
  cost of more frequent, smaller Parquet chunks and extra merge work at the end
  of the run.
- The default chunk size (4,096 samples) balances throughput and peak memory for
  most workloads, but busy datasets or constrained workers may benefit from
  smaller chunks coupled with increased batch timeout settings.

## Handling Discovery Results

`discoveryDir()` returns an object containing baseline metrics, raw discovery
hints, and any validated improvements. When `result.improvement` is defined:

- The improved creature inherits new weights and structural changes. Preserve
  the returned JSON verbatim so the receiving trainer sees the exact candidate
  that discovery validated.
- Tags contain the new `score`, `error`, and a human-readable `message`
  describing the change.
- The orchestrator should still re-score the candidate on the full production
  dataset before promoting it to avoid overfitting to the sampled discovery
  data.

When `result.improvement` is `undefined`, discovery exhausted the search space
for the allotted window. Record the run duration and retry later with a
refreshed sample or extended timeout.

### Error impact estimation

Discovery candidates report an `expectedErrorReduction` field which is now
normalized to the creature’s total error before being logged or ranked. The
estimator walks backwards from each output neuron, distributing error share
across inbound synapses proportional to their absolute weights (falling back to
equal splits when weights sum to ~0). A neuron that feeds an output via 100
equally weighted synapses therefore receives at most `1 / 100` of that output’s
error share, and upstream neurons inherit the product of shares along the path.

This normalization prevents large hidden layers from exaggerating their impact
and keeps the “expected vs actual” comparison realistic even for huge
creatures—particularly those similar to the `GRQ-3-1` sample with hundreds of
synapses terminating at each output. Consumers of `expectedErrorReduction`
should rely on the normalized value; no additional scaling is required in
controllers or dashboards.

## Troubleshooting Checklist

- **Rust module not found** – rebuild `NEAT-AI-Discovery` and confirm
  `isRustDiscoveryEnabled()` returns `true`. Use `NEAT_AI_DISCOVERY_LIB_PATH` to
  point directly at the compiled artefact if your installation directory differs
  from the defaults.
- **JSON outputs are empty** – check that the controlling script writes to a
  temporary file before renaming. Interrupted writes that open the final path
  directly can leave a zero-length artefact and break downstream fetchers.
- **No improvements recorded** – inspect the discovery dataset size and sample
  rate. Increasing `discoverySampleRate` or refreshing the sampled data often
  uncovers new mutations for consideration.

## Focus Selection Analysis

Discovery automatically generates JSON analysis files documenting which neurons
were considered for focus during each selection phase. These files are written
to `.discovery/focus-analysis/{discoveryID}/` and provide detailed insight into
the weighted random selection process.

### File Format

Each focus selection produces a JSON file with the following structure:

```json
{
  "discoveryID": "a1b2c3d4",
  "timestamp": "2025-11-22T10:30:45.123Z",
  "costOfGrowth": 0.05,
  "selectionMethod": "weighted",
  "totalCandidates": 6,
  "selectedCount": 2,
  "totalWeightedSum": 1.234,
  "candidates": [
    {
      "neuronUuid": "neuron-high-high",
      "totalError": 1.0,
      "impact": 0.95,
      "potentialErrorReduction": 0.95,
      "activationAffectPct": 95.0,
      "weightedScore": 0.950095,
      "selected": true
    },
    ...
  ],
  "lowImpactNeurons": [
    {
      "neuronUuid": "neuron-low-low",
      "impact": 0.001,
      "activationAffectPct": 0.1,
      "totalError": 0.1,
      "reason": "Impact 0.001000 < cost of growth 0.05"
    }
  ],
  "retryNumber": 2
}
```

### Field Descriptions

#### Analysis Metadata

- **discoveryID** – Short identifier for this discovery run (typically last 8
  chars of creature UUID)
- **timestamp** – ISO 8601 timestamp when neurons were selected
- **costOfGrowth** – Structural penalty threshold used for growth decisions
- **selectionMethod** – Selection strategy: `"weighted"`, `"all"`,
  `"random-fallback-nan"`, or `"random-fallback-zero"`
- **totalCandidates** – Total number of neurons evaluated (hidden + output
  neurons)
- **selectedCount** – Number of neurons chosen for analysis this round
- **totalWeightedSum** – Sum of weighted scores (may be scaled to respect output
  error caps)
- **retryNumber** – Present only on retry attempts (1, 2, 3, etc.)

#### Candidate Neuron Metrics

- **neuronUuid** – Unique identifier for the neuron
- **totalError** – Average absolute error for this neuron (capped by max output
  error)
- **impact** – Measure of how much the neuron affects outputs through outgoing
  synapse weights (0.0 to 1.0)
- **potentialErrorReduction** – `totalError × impact` – the creature-level error
  reduction if this neuron's error dropped to zero
- **activationAffectPct** – `impact × 100` – percentage of outputs affected by
  this neuron
- **weightedScore** – `totalError × (impact + ε)` – actual weight used in
  roulette-wheel selection
- **selected** – `true` if this neuron was chosen for analysis, `false`
  otherwise

**Candidates are sorted by `potentialErrorReduction` (descending)**, placing
neurons with the highest potential for creature-level improvement at the top of
the list.

#### Low-Impact Neurons

Neurons where `impact < costOfGrowth` are flagged as low-impact candidates. In
production these neurons contribute little to outputs and may be candidates for
removal if spare re-score workers are available. Each entry includes:

- **neuronUuid** – The neuron identifier
- **impact** / **activationAffectPct** – The neuron's influence metrics
- **totalError** – Average error magnitude
- **reason** – Human-readable explanation of why it's flagged

### Interpreting the Analysis

1. **Verify weighted selection is working** – Compare the `weightedScore` values
   to the `selected` flags. Neurons with higher weighted scores should be
   selected more frequently across multiple runs.

2. **Identify high-potential neurons** – Look at the top candidates sorted by
   `potentialErrorReduction`. These represent the best opportunities for error
   reduction from the creature's perspective.

3. **Check for selection bias** – If the same neurons are always selected,
   verify that error values are being updated correctly and that different
   neurons have varying error levels.

4. **Monitor low-impact neurons** – If many neurons have
   `impact < costOfGrowth`, the network might benefit from pruning. These
   neurons consume growth budget but contribute minimally to outputs.

5. **Analyse retry patterns** – When `retryNumber` is present, compare across
   retries to see if the selection is exploring different neurons or repeatedly
   choosing the same ones (indicating exhausted options).

### File Naming Convention

- **First selection**: `{timestamp}-focus-selection.json`
- **Retry selections**: `{timestamp}-focus-selection-retry-{N}.json`

Multiple retry files in the same discovery run indicate that initial analysis
attempts did not yield viable candidates, triggering re-selection of different
focus neurons.

### Using the Analysis

**Debugging no-discovery situations**: When discovery runs for hours without
finding improvements, examine the focus selection JSON to verify:

- Are neurons with high `potentialErrorReduction` being selected?
- Is the `selectionMethod` falling back to random (indicating data quality
  issues)?
- Are most neurons showing very low error values (suggesting the creature is
  already well-optimised)?
- Do all candidates have similar weighted scores (reducing selection diversity)?

**Validating selection logic**: The JSON proves whether weighted random
selection is functioning correctly. Higher `weightedScore` values should
correlate with higher selection frequency when sampling the same creature
multiple times.
