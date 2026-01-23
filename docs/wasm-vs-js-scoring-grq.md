# WASM vs JS scoring benchmark (GRQ creature + large dataset)

This document benchmarks **end-to-end scoring** (dataset evaluation + cost
aggregation + score calculation) for a **large creature** using **WASM
activation** vs **forced JS activation**, and checks whether both paths produce
the **same score**.

## Re-running later (copy/paste)

1. Build the local WASM package (not checked in):

```bash
cd ~/Develop/NEAT-AI
bash wasm_activation/build.sh
```

2. Run the benchmark runner exactly as used for this document (prints JSON you
   can diff/compare):

```bash
cd ~/Develop/NEAT-AI
deno run --allow-read --allow-env --no-check - <<'EOF'
import { Creature, Costs } from 'file://~/Develop/NEAT-AI/mod.ts';
import { initWasmActivation, isWasmActivationAvailable } from 'file://~/Develop/NEAT-AI/src/wasm/mod.ts';
import { calculate as calculateScore } from 'file://~/Develop/NEAT-AI/src/architecture/Score.ts';

const networkPath = '~/Develop/GRQ-cluster/network.json';
const dataDir = '~/Develop/GRQ/.trainData-binary_89';
const costName = 'MSE';
const costOfGrowth = 0.0000001; // DEFAULT_COST_OF_GROWTH
const feedbackLoop = false;

await initWasmActivation('~/Develop/NEAT-AI/wasm_activation/pkg');
if (!isWasmActivationAvailable()) throw new Error('WASM unavailable');

const json = JSON.parse(await Deno.readTextFile(networkPath));
const base = Creature.fromJSON(json);
base.fix();
base.clearState();

function listBinFilesSorted(dir) {
  const files = [];
  for (const e of Deno.readDirSync(dir)) {
    if (e.isFile && e.name.endsWith('.bin')) files.push(dir + '/' + e.name);
  }
  files.sort();
  return files;
}

function evaluateSorted(creature, files, { useJs }) {
  const cost = Costs.find(costName);
  let error = 0;
  let count = 0;

  const valuesCount = creature.input + creature.output;
  const BYTES_PER_RECORD = valuesCount * 4;
  const SSD_OPTIMAL_READ_SIZE = 128 * 1024;
  const BATCH_SIZE = Math.max(1, Math.floor(SSD_OPTIMAL_READ_SIZE / BYTES_PER_RECORD));
  const BYTES_PER_BATCH = BYTES_PER_RECORD * BATCH_SIZE;

  const batchBuffer = new Uint8Array(BYTES_PER_BATCH);
  const batchArray = new Float32Array(batchBuffer.buffer);

  for (let fileIndx = files.length; fileIndx--;) {
    const filePath = files[fileIndx];
    const file = Deno.openSync(filePath, { read: true });
    try {
      while (true) {
        const bytesRead = file.readSync(batchBuffer);
        if (bytesRead === null) break;
        const recordsRead = Math.floor(bytesRead / BYTES_PER_RECORD);
        for (let recordIndex = 0; recordIndex < recordsRead; recordIndex++) {
          const offset = recordIndex * valuesCount;
          const inputEnd = offset + creature.input;
          const observations = new Float32Array(batchArray.subarray(offset, inputEnd));
          const actual = useJs
            ? creature.activate(observations, feedbackLoop, false, true)
            : creature.activate(observations, feedbackLoop);
          const target = new Float32Array(batchArray.subarray(inputEnd, offset + valuesCount));
          error += cost.calculate(target, actual);
          count++;
        }
      }
    } finally {
      file.close();
    }
  }

  const averageError = count === 0 ? 0 : (error / count);
  const score = calculateScore(creature, averageError, costOfGrowth);
  return { averageError, score, count };
}

const files = listBinFilesSorted(dataDir);

const wasmCreature = base.shallowClone(); wasmCreature.clearState();
const jsCreature = base.shallowClone(); jsCreature.clearState();

// Warmup compile / JIT
wasmCreature.activate(new Float32Array(base.input), false);
jsCreature.activate(new Float32Array(base.input), false, false, true);

const t0 = performance.now();
const wasm = evaluateSorted(wasmCreature, files, { useJs: false });
const t1 = performance.now();
const js = evaluateSorted(jsCreature, files, { useJs: true });
const t2 = performance.now();

console.log(JSON.stringify({
  wasmMs: t1 - t0,
  jsMs: t2 - t1,
  wasm,
  js,
  scoreDiff: wasm.score - js.score,
  errorDiff: wasm.averageError - js.averageError,
}, null, 2));
EOF
```

3. What to compare in the output JSON:

- **Correctness**: `scoreDiff` and `errorDiff` should both be **0** (or within a
  tiny epsilon if you later change accumulation).
- **Performance**: compare `wasmMs` vs `jsMs` only after correctness is fixed.

## Inputs

- **Creature**: `~/Develop/GRQ-cluster/network.json`
- **Training data**: `~/Develop/GRQ/.trainData-binary_89` (binary
  `.bin` files)

## Environment

- **Repo branch**: `1147-wasm-scoring-benchmark`
- **Repo commit**: `3d09e3d143e5e23523c7e4de9d0f607e234d1ae5`
- **OS**: macOS 26.2 (Darwin 25.2.0) on arm64
- **CPU**: Apple M4 (10 cores)
- **RAM**: 24 GB
- **Deno**: 2.6.5

## Setup

WASM needs to be built locally (the `pkg/` artifacts are not checked in):

```bash
cd ~/Develop/NEAT-AI
bash wasm_activation/build.sh
```

## Methodology

### What we measured

- **Workload**: iterate every record in every `.bin` file, call `activate(...)`,
  compute **MSE**, average it, then compute final score via
  `calculateScore(creature, avgError, costOfGrowth)`.
- **WASM run**: `creature.activate(observations, feedbackLoop)` (WASM used
  automatically when available).
- **JS run**:
  `creature.activate(observations, feedbackLoop, reuseBuffer=false, useJs=true)`
  (forces JS activation).

### Why we did not call `Creature.scoreDir(...)` directly

`Creature.scoreDir()` calls `evaluateDir()`, which calls `dataFiles(dataDir)`
without options; by default that shuffles file order. For a very large run, that
can change floating-point summation order (and makes comparisons harder to
reproduce).

To ensure the JS vs WASM comparison is **byte-for-byte reproducible**, the
benchmark explicitly:

- scans `dataDir` for `*.bin`
- sorts file names
- then evaluates them in that deterministic order

### Dataset + creature size

- **Files**: 494
- **Records**: 2,160,230
- **Creature**:
  - input: 1556
  - output: 1
  - neurons: 2292
  - synapses: 18,201
  - WASM eligibility: `getUnsupportedWasmSquashFunctions()` returned `[]`
    (eligible)

### Exact command used (ad-hoc runner)

This was executed locally via `deno run` (script provided inline here for
transparency; nothing was checked in besides this document):

```bash
deno run --allow-read --allow-env --no-check - <<'EOF'
import { Creature, Costs } from 'file://~/Develop/NEAT-AI/mod.ts';
import { initWasmActivation, isWasmActivationAvailable } from 'file://~/Develop/NEAT-AI/src/wasm/mod.ts';
import { calculate as calculateScore } from 'file://~/Develop/NEAT-AI/src/architecture/Score.ts';

const networkPath = '~/Develop/GRQ-cluster/network.json';
const dataDir = '~/Develop/GRQ/.trainData-binary_89';
const costName = 'MSE';
const costOfGrowth = 0.0000001; // DEFAULT_COST_OF_GROWTH
const feedbackLoop = false;

await initWasmActivation('~/Develop/NEAT-AI/wasm_activation/pkg');
if (!isWasmActivationAvailable()) throw new Error('WASM unavailable');

const json = JSON.parse(await Deno.readTextFile(networkPath));
const base = Creature.fromJSON(json);
base.fix();
base.clearState();

function listBinFilesSorted(dir) {
  const files = [];
  for (const e of Deno.readDirSync(dir)) {
    if (e.isFile && e.name.endsWith('.bin')) files.push(dir + '/' + e.name);
  }
  files.sort();
  return files;
}

function evaluateSorted(creature, files, { useJs }) {
  const cost = Costs.find(costName);
  let error = 0;
  let count = 0;

  const valuesCount = creature.input + creature.output;
  const BYTES_PER_RECORD = valuesCount * 4;
  const SSD_OPTIMAL_READ_SIZE = 128 * 1024;
  const BATCH_SIZE = Math.max(1, Math.floor(SSD_OPTIMAL_READ_SIZE / BYTES_PER_RECORD));
  const BYTES_PER_BATCH = BYTES_PER_RECORD * BATCH_SIZE;

  const batchBuffer = new Uint8Array(BYTES_PER_BATCH);
  const batchArray = new Float32Array(batchBuffer.buffer);

  for (let fileIndx = files.length; fileIndx--;) {
    const filePath = files[fileIndx];
    const file = Deno.openSync(filePath, { read: true });
    try {
      while (true) {
        const bytesRead = file.readSync(batchBuffer);
        if (bytesRead === null) break;
        const recordsRead = Math.floor(bytesRead / BYTES_PER_RECORD);
        for (let recordIndex = 0; recordIndex < recordsRead; recordIndex++) {
          const offset = recordIndex * valuesCount;
          const inputEnd = offset + creature.input;
          const observations = new Float32Array(batchArray.subarray(offset, inputEnd));
          const actual = useJs
            ? creature.activate(observations, feedbackLoop, false, true)
            : creature.activate(observations, feedbackLoop);
          const target = new Float32Array(batchArray.subarray(inputEnd, offset + valuesCount));
          error += cost.calculate(target, actual);
          count++;
        }
      }
    } finally {
      file.close();
    }
  }

  const averageError = count === 0 ? 0 : (error / count);
  const score = calculateScore(creature, averageError, costOfGrowth);
  return { averageError, score, count };
}

const files = listBinFilesSorted(dataDir);

const wasmCreature = base.shallowClone(); wasmCreature.clearState();
const jsCreature = base.shallowClone(); jsCreature.clearState();

// Warmup compile / JIT
wasmCreature.activate(new Float32Array(base.input), false);
jsCreature.activate(new Float32Array(base.input), false, false, true);

const t0 = performance.now();
const wasm = evaluateSorted(wasmCreature, files, { useJs: false });
const t1 = performance.now();
const js = evaluateSorted(jsCreature, files, { useJs: true });
const t2 = performance.now();

console.log(JSON.stringify({
  wasmMs: t1 - t0,
  jsMs: t2 - t1,
  wasm,
  js,
  scoreDiff: wasm.score - js.score,
  errorDiff: wasm.averageError - js.averageError,
}, null, 2));
EOF
```

## Results

### Correctness (score parity)

For this creature + dataset, **WASM and JS do not produce the same score**:

- **WASM**:
  - average error: **1.5397876754**
  - score: **-0.5400432044**
- **JS (forced)**:
  - average error: **0.5883924738**
  - score: **0.4113519972**
- **Differences**:
  - average error diff (WASM − JS): **+0.9513952016**
  - score diff (WASM − JS): **-0.9513952016**

A single-record spot check also shows a large activation mismatch:

- First record from `A-2008.bin`
  - WASM output: `[-1]`
  - JS output: `[-0.08030710369348526]`

### Performance (end-to-end scoring)

One full pass over the dataset (deterministic file order):

- **WASM time**: **125.501 s**
- **JS time**: **62.580 s**
- **Relative**: WASM is **~2.01× slower** than JS for this scoring workload.

Three-trial run (alternating which variant ran first):

|    Trial |    WASM (s) |     JS (s) | WASM / JS |
| -------: | ----------: | ---------: | --------: |
|        1 |     128.600 |     61.200 |     2.102 |
|        2 |     126.337 |     60.096 |     2.102 |
|        3 |     127.806 |     62.091 |     2.058 |
| **Mean** | **127.581** | **61.129** | **2.088** |

## Conclusion

With the provided GRQ creature and large binary training dataset:

- **Score parity is not satisfied** (WASM and JS produce materially different
  errors/scores).
- **WASM is not faster** for end-to-end scoring here; it is **~2× slower** than
  forced JS.

This means we **cannot** safely remove the JS scoring path based on this
benchmark; there is a correctness gap (and a performance regression for this
workload).

## Notes / likely next debugging targets (not implemented here)

- The WASM activation output for this network appears to saturate to `-1` on at
  least some inputs where JS does not, suggesting a numerical/implementation
  mismatch for this specific large-input network.
- A focused correctness test that compares JS vs WASM activation on a fixed set
  of records from this dataset (with deterministic ordering) would make this
  regression easy to reproduce in CI.
