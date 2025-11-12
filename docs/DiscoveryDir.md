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
     --discoveryTimeOutMinutes=15 \
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
