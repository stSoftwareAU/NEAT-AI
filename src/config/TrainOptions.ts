/**
 * @module
 *
 * The public configuration surface for a training run — everything
 * `Creature.train` / `trainDir` accept beyond the dataset itself.
 *
 * {@link TrainArguments} is the fully-resolved shape (every field present) and
 * extends `BackPropagationArguments`, so learning-rate and gradient settings
 * sit alongside training-loop settings such as `iterations`, `targetError`,
 * `log`, cross-validation, data fuzzing/quantisation, predictive coding and
 * synthetic synapses. {@link TrainOptions} is the caller-facing
 * `Partial<TrainArguments>`: supply only what you want to override and the
 * training code fills in the documented defaults.
 *
 * This module holds the interface pair and its per-field documentation only —
 * default values and validation live with the code that consumes them.
 *
 * ## Rust `trainDir` (`neat_ai_backpropagation`) — what is honoured
 *
 * Eligible requests prefer in-process Deno FFI
 * (`libneat_ai_backpropagation`, Issue #3765) and fall back to spawning the
 * CLI when the cdylib is absent (see `RustTrainDirBridge.ts` /
 * `NativeBackpropLibrary.ts`). `./quality.sh --next` requires the FFI path.
 *
 * **Forwarded / applied by Rust (FFI and CLI)**
 * - `iterations` → epochs
 * - `learningRate`, `learningRateStrategy`, `learningRateDecay`
 * - `maximumBiasAdjustmentScale`, `maximumWeightAdjustmentScale`
 * - `normaliseGradients`
 * - `trainingSampleRate` → `maxRecords` when `< 1` (seeded random sample
 *   across files; `disableRandomSamples: true` takes each file's leading
 *   prefix — NEAT-AI-Backpropagation#77)
 * - `disableRandomSamples` / seed (`NEAT_AI_BACKPROP_SEED` override)
 * - `traceStore` → CreatureTrace artefacts (NEAT-AI-Backpropagation#78)
 * - `syntheticSynapses` — TypeScript generates synapses before the call;
 *   Rust trains the resulting topology
 *
 * **Skip Rust (TypeScript / WASM loop)** — not backpropagation:
 * `predictiveCoding`, `dropoutRate`, `gradientOrthogonalisation: "muon"`,
 * `feedbackLoop`, recurrent (`forwardOnly !== true`), non-MSE cost.
 *
 * **TypeScript-only orchestration (Rust path ignores today)**
 * - `log`, `targetError`, `trainingTimeOutMinutes`, `hardDeadlineTS`
 *   (FFI unlocks honouring these without re-spawning; not wired yet)
 * - Most other `BackPropagationArguments` (e.g. `sparseRatio`,
 *   `generations`, L1/L2, `batchSize`) are not ABI/CLI fields yet
 *
 * **FFI-only convenience** (same fields as CLI, no process spawn): shared
 * in-process creature JSON, lower overhead per memetic `trainDir`. Mid-epoch
 * cancellation for `hardDeadlineTS` / `targetError` remains a follow-up.
 */
import type { BackPropagationArguments } from "@propagate/BackPropagation.ts";
import type { PredictiveCodingConfig } from "@config/PredictiveCodingConfig.ts";

export interface TrainArguments extends BackPropagationArguments {
  /** If set to n, will output the training status every n iterations (log : 1 will log every iteration) */
  log: number;

  /** The target error to reach, once the network falls below this error, the process is stopped. Default: 0.05, Range 0..1 */
  targetError: number;

  /**
   * Sets the amount of iterations the process will maximally run,
   * even when the target error has not been reached. Default: 2
   *
   * Note: Need to run at least 2 iterations to allow rollback if training makes the network worse.
   */
  iterations: number;

  /**
   * Directory to store network trace JSON when an iteration makes the error
   * worse (TypeScript path writes `failed/<uuid>.json`).
   *
   * Rust path (FFI and CLI): forwarded as `traceStore` /
   * `--trace-store` (NEAT-AI-Backpropagation#78).
   */
  traceStore?: string;

  /**
   * The percentage of observations that will be used for training. Range 0..1.
   *
   * TypeScript path: per-file random sample via `selectFileSampleIndexes`
   * unless `disableRandomSamples` is set.
   *
   * Rust path: forwarded as `maxRecords` / `--max-records` when this is
   * `< 1`. Default is a seeded random draw across files; set
   * `disableRandomSamples: true` for a deterministic per-file prefix
   * (NEAT-AI-Backpropagation#77).
   */
  trainingSampleRate: number;

  /** The maximum number of minutes to train for */
  trainingTimeOutMinutes: number;

  /**
   * Absolute hard deadline (epoch milliseconds) at which training must stop.
   *
   * Issue #2899: A scheduled fine-tuning task may sit in the worker queue
   * after being scheduled with a relative {@link trainingTimeOutMinutes}
   * budget. The relative budget is otherwise anchored when the worker
   * dequeues the task, so a queued task can run past the run's wall-clock
   * deadline. Carrying the absolute deadline lets the worker clamp the
   * relative budget to `min(now + trainingTimeOutMinutes, hardDeadlineTS)`.
   *
   * A plain number so it survives `Worker.postMessage`. When absent,
   * behaviour is unchanged (direct `creature.train()` callers are
   * unaffected).
   *
   * Not forwarded to `neat_ai_backpropagation` yet (TypeScript loop only;
   * Issue #3765 notes FFI as the path to honour this in-process).
   */
  hardDeadlineTS?: number;

  /**
   * Enable feedback loop where the previous result feeds back into the next interaction.
   * Useful for time-series forecasting and recurrent neural networks.
   * More information: https://www.mathworks.com/help/deeplearning/ug/design-time-series-narx-feedback-neural-networks.html
   *
   * Skips the Rust trainer (not trained by the WASM/Rust backprop path).
   */
  feedbackLoop: boolean;

  /**
   * Predictive Coding configuration.
   *
   * Issue #1556: When predictiveCoding.enabled is true, training uses
   * local Hebbian learning rules driven by prediction error minimisation
   * instead of standard backpropagation.
   *
   * Skips the Rust trainer.
   */
  predictiveCoding: PredictiveCodingConfig;

  /**
   * Enable synthetic synapse generation during training.
   *
   * Issue #1923: When true, dense inter-layer synapses are generated
   * before backpropagation begins. After training, near-zero synthetic
   * synapses are pruned and orphaned neurons cleaned up. This allows
   * backpropagation to discover useful connections that NEAT's
   * evolutionary process may not have found.
   *
   * Default: false (opt-in). Generation/prune stay in TypeScript; the Rust
   * trainer then trains the expanded topology.
   */
  syntheticSynapses: boolean;
}

export type TrainOptions = Partial<TrainArguments>;
