/**
 * EpisodeAdapter.ts — Class-shaped adapter contract for the
 * reinforcement-learning episode runner (Issue #2626, part of #2624).
 *
 * This is the single seam between NEAT-AI and a caller's RL environment.
 * Subclasses MUST override the abstract members (`reset`, `step`,
 * `observationLength`, `decodeAction`); the termination guard methods
 * (`maxSteps()`, `wallClockMs()`) ship with library defaults and MAY be
 * overridden for slower or faster simulators.
 *
 * Return shape semantics intentionally mirror Gym/Gymnasium so users coming
 * from those libraries recognise it: `terminated` (natural episode end —
 * death, goal) and `truncated` (a guard fired — step cap or wall-clock cap)
 * are distinct fields, never collapsed into a single `done` flag.
 *
 * Type discipline (Issue #1958 + AGENTS.md): the simulator state type `S` is
 * opaque to NEAT-AI. It is passed back through `step()` unchanged but MUST
 * NEVER cross a worker boundary directly — only the adapter's import URL,
 * its JSON config, and the creature's UUID-only genome cross. Adapter wire
 * types must be JSON-serialisable so the worker pool tracked by #2612 can
 * ship adapter descriptions to off-thread rollouts.
 */

import { AdapterContractError } from "@errors/AdapterContractError.ts";

/**
 * Result of a single environment `step()` call. Mirrors Gymnasium's
 * `(obs, reward, terminated, truncated, info)` return shape.
 *
 * @typeParam O — Observation type. The runner expects `Float32Array` so the
 *   genome can consume it directly via `Creature.activate(observation)`.
 */
export interface StepResult<O> {
  /** Observation produced by stepping the environment. */
  readonly observation: O;
  /** Scalar reward for this transition. */
  readonly reward: number;
  /** Natural episode end (death, goal reached, terminal absorbing state). */
  readonly terminated: boolean;
  /** A guard fired (step cap or wall-clock cap) — episode cut short. */
  readonly truncated: boolean;
  /** Optional diagnostic payload; opaque to the runner. */
  readonly info?: Readonly<Record<string, unknown>>;
}

/**
 * Default hard cap on the number of ticks per episode. Acts as a safety net
 * for simulators that may never set `terminated = true`. Subclasses can
 * override {@link EpisodeAdapter.maxSteps} to lift or lower this cap.
 */
export const DEFAULT_MAX_STEPS = 5000;

/**
 * Default wall-clock cap per episode in milliseconds. Wall-clock is the
 * primary guard since the library cannot know the game's per-step cost in
 * advance. Subclasses can override {@link EpisodeAdapter.wallClockMs} for
 * slower or faster simulators.
 */
export const DEFAULT_WALL_CLOCK_MS = 60_000;

/**
 * Abstract base class for reinforcement-learning episode adapters.
 *
 * Java-class-style contract:
 *
 * - Required (`abstract`) methods MUST be overridden. They define how the
 *   simulator resets, advances, exposes its observation shape, and decodes
 *   creature outputs into actions.
 * - Termination-guard methods (`maxSteps`, `wallClockMs`) ship library
 *   defaults that MAY be overridden.
 *
 * Validation runs lazily on first use (see {@link assertContract}) rather
 * than in the constructor so subclasses can defer their own initialisation.
 *
 * @typeParam S — Simulator state type. Opaque to NEAT-AI.
 * @typeParam A — Action type emitted by `decodeAction()` and consumed by
 *   `step()`.
 */
export abstract class EpisodeAdapter<S = unknown, A = unknown> {
  /**
   * `true` once {@link assertContract} has validated the subclass return
   * shapes. Repeated checks would be wasted work on the hot path.
   */
  private contractChecked = false;

  // --- MUST override -------------------------------------------------------

  /**
   * Initialise (or re-initialise) the simulator and return the starting
   * observation plus the initial state.
   *
   * Determinism: when the same `rngSeed` is supplied twice the adapter MUST
   * produce identical state, observations, and step transitions, otherwise
   * the runner's reproducibility guarantees are broken.
   *
   * @param rngSeed — Deterministic seed for the simulator's RNG.
   */
  abstract reset(rngSeed: number): { observation: Float32Array; state: S };

  /**
   * Apply `action` to `state` and return the resulting transition. The
   * returned `state` is threaded into the next `step()` call by the runner —
   * this is the streaming-observation pattern.
   */
  abstract step(state: S, action: A): StepResult<Float32Array> & { state: S };

  /**
   * Number of input neurons the creature must have. Equivalent to the
   * length of `Float32Array` returned by `reset()` / `step()`.
   */
  abstract get observationLength(): number;

  /**
   * Decode the creature's raw output vector into the action consumed by
   * {@link step}. Called once per tick after `Creature.activate(observation)`.
   *
   * @param creatureOutput — Raw output from `Creature.activate()`.
   * @param state — Current simulator state, in case action decoding depends
   *   on context (e.g. legal-move masking).
   */
  abstract decodeAction(creatureOutput: Float32Array, state: S): A;

  // --- MAY override (library defaults) -------------------------------------

  /**
   * Hard cap on the number of ticks per episode. Whichever guard fires
   * first ({@link maxSteps} or {@link wallClockMs}) truncates the episode.
   *
   * Default: {@link DEFAULT_MAX_STEPS} (5000).
   */
  maxSteps(): number {
    return DEFAULT_MAX_STEPS;
  }

  /**
   * Wall-clock cap per episode in milliseconds. Primary guard for
   * simulators with unknown per-step cost.
   *
   * Default: {@link DEFAULT_WALL_CLOCK_MS} (60 000 ms = 60 seconds).
   */
  wallClockMs(): number {
    return DEFAULT_WALL_CLOCK_MS;
  }

  // --- Library plumbing ----------------------------------------------------

  /**
   * Validate the subclass's contract on first use.
   *
   * Lazy by design: the constructor cannot run this because subclasses may
   * still be initialising fields when the base constructor returns.
   * Library code that drives the adapter (the episode runner introduced in
   * a follow-up sub-issue) MUST invoke this at least once before using any
   * other method, typically right after wiring the adapter into the runner.
   *
   * Subsequent calls are no-ops.
   *
   * @throws {AdapterContractError} when:
   *   - {@link observationLength} is not a positive finite integer
   *   - {@link maxSteps} is not a positive finite integer
   *   - {@link wallClockMs} is not a positive finite number
   *   - {@link reset} returns an `observation` that is not a `Float32Array`
   *     of the declared length
   */
  assertContract(rngSeed = 0): void {
    if (this.contractChecked) return;

    const obsLen = this.observationLength;
    if (
      !Number.isFinite(obsLen) ||
      !Number.isInteger(obsLen) ||
      obsLen <= 0
    ) {
      throw new AdapterContractError(
        `EpisodeAdapter.observationLength must be a positive finite integer, ` +
          `got ${String(obsLen)}`,
        "INVALID_OBSERVATION_LENGTH",
      );
    }

    const cap = this.maxSteps();
    if (!Number.isFinite(cap) || !Number.isInteger(cap) || cap <= 0) {
      throw new AdapterContractError(
        `EpisodeAdapter.maxSteps() must return a positive finite integer, ` +
          `got ${String(cap)}`,
        "INVALID_MAX_STEPS",
      );
    }

    const wall = this.wallClockMs();
    if (!Number.isFinite(wall) || wall <= 0) {
      throw new AdapterContractError(
        `EpisodeAdapter.wallClockMs() must return a positive finite number, ` +
          `got ${String(wall)}`,
        "INVALID_WALL_CLOCK_MS",
      );
    }

    const initial = this.reset(rngSeed);
    if (!(initial.observation instanceof Float32Array)) {
      throw new AdapterContractError(
        `EpisodeAdapter.reset() must return a Float32Array observation, got ` +
          `${typeof initial.observation}`,
        "INVALID_OBSERVATION_TYPE",
      );
    }
    if (initial.observation.length !== obsLen) {
      throw new AdapterContractError(
        `EpisodeAdapter.reset() returned ${initial.observation.length} ` +
          `observation values, expected ${obsLen} (observationLength)`,
        "INVALID_OBSERVATION_SIZE",
      );
    }

    this.contractChecked = true;
  }
}
