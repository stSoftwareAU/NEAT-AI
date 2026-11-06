# Native backpropagation fixtures (Issue #4119)

Captured from the real `libneat_ai_backpropagation` and
`neat_ai_backpropagation` binaries, never hand-written. They pin the C ABI and
CLI contract that `src/architecture/training/NativeBackpropLibrary.ts` parses.
Do not edit them by hand; regenerate from the producers below if the contract
moves.

| Binary        | Source                                             | Version  | Deadline capability                                                       |
| ------------- | -------------------------------------------------- | -------- | ------------------------------------------------------------------------- |
| NEW engine    | stSoftwareAU/NEAT-AI-Backpropagation git `947cbb5` | `0.1.50` | yes (`deadline` v1)                                                       |
| LEGACY engine | stSoftwareAU/NEAT-AI-Backpropagation git `f444bc4` | `0.1.49` | no (no `neat_backprop_capabilities` symbol, no `capabilities` subcommand) |

## Files

- `capabilities-new.json` — the stdout of the NEW CLI `capabilities` subcommand,
  pretty-printed (whitespace only; content unchanged):

  ```sh
  <new-engine-dir>/neat_ai_backpropagation capabilities
  ```

  The legacy CLI has no such subcommand; it exits 2 with
  `error: unrecognized subcommand 'capabilities'`, so no fixture is captured
  from it.

- `ffi-response-legacy.json` — the real `neat_backprop_train` response from the
  LEGACY library (`0.1.49`). No `timedOut`, `timeout`, `completedEpochs`,
  `baselineMeasure` or `bestMeasure` fields; `baselineMse` and `bestMse` are
  numbers.

- `ffi-response-new-completed.json` — the NEW library (`0.1.50`), a run with no
  deadline. `timedOut` is `false`, `timeout` is `null`, both measures are `full`
  with `records: 100`, and `baselineMse` / `bestMse` are numbers equal to their
  measure's `mse`.

- `ffi-response-new-timed-out-expired.json` — the NEW library with
  `deadlineEpochMs: 1` (already expired, so the run stops before any work).
  `timedOut` is `true`, `timeout` is
  `{"phase":"start","completedEpochs":0,"weightsChanged":false,"deadlineEpochMs":1}`,
  both measures are `unmeasured`, `baselineMse` / `bestMse` are `null`, and
  `bestCreatureJson` equals the input creature.

- No `ffi-response-new-timed-out-partial.json`. A `partial` measure needs the
  deadline to land inside the baseline measurement, which is a narrow and
  nondeterministic window (1–10 ms offsets gave `unmeasured`, 13 ms and above
  gave `full`, in a sweep on the tiny creature). It was skipped rather than
  invented.

- `cli-train-legacy/` — a real `neat_ai_backpropagation train` run of the LEGACY
  CLI (`0.1.49`), captured by a wrapper that recorded the arguments and copied
  the input creature and the output directory. The arguments and the engine's
  output are verbatim apart from the per-run paths, which are replaced with
  `<WORK_DIR>` and `<DATA_DIR>` in `argv.txt`:
  - `input-creature.json` — the 1-input / 1-output identity chain with three
    hidden neurons the bridge wrote as `creature.json`.
  - `argv.txt` — the argument list, one per line. It has no
    `--deadline-epoch-ms`; the legacy CLI has no such flag.
  - `best.json`, `journal.jsonl` — the engine's output (`journal.jsonl` has a
    `runHeader` and three `epoch` lines; `candidate.json` was also written and
    is not read by the bridge, so it is not kept).
  - Produced by the `legacy-cli` scenario of `scripts/native_deadline_probe.ts`
    (three epochs, seed 1, `disableRandomSamples`). `RustTrainDirDeadline.ts`
    replays them through a fake CLI to check the arguments, the result read from
    the journal and `best.json`, and the once-only "not enforced natively"
    warning.

## How the FFI responses were produced

A throwaway Deno driver (not kept in the repository) loaded the library directly
over FFI and called `neat_backprop_train`, with:

```sh
deno run --no-config --no-lock --allow-ffi --allow-read --allow-write driver.ts <libPath> <outFile> [deadlineEpochMs]
```

- `<libPath>`: `<legacy-engine-dir>/libneat_ai_backpropagation.so` for the
  legacy file, `<new-engine-dir>/libneat_ai_backpropagation.so` for the new
  ones.
- The dataset is a temporary directory holding `0.bin`: 100 little-endian f32
  `(x, 2x)` pairs, with `x` cycling through `0.1 … 1.0`.
- The creature is the 1-input / 1-output identity chain `input-0 → h1 → h2 → o1`
  (all weights `1.0`, all biases `0.0`, `IDENTITY` squashes, `semanticVersion`
  `4.0.0`, `forwardOnly` true).
- Request: `creatureJson` (the creature above, stringified), `trainingData` (the
  dataset directory), `outputDir` (a temporary directory), `epochs: 1`,
  `seed: 1`, `disableRandomSamples: true`, `learningRate: 0.01`,
  `learningRateStrategy: "fixed"`, `learningRateDecay: 0.0`,
  `maximumBiasAdjustmentScale: 1`, `maximumWeightAdjustmentScale: 1`,
  `stepScale: 0.01`, `normaliseGradients: false`. No other fields.
- `deadlineEpochMs` is present only for the expired capture (value `1`). It is
  omitted entirely for the legacy and completed captures, because the legacy
  engine rejects unknown request fields.

## Normalisation

The temporary `outputDir` is machine-specific, so it was replaced with the
placeholder `<OUTPUT_DIR>` in `bestPath` and `journalPath`. Nothing else was
changed. The `bestCreatureJson` strings are verbatim engine output.
