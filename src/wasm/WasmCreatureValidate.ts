/**
 * @module
 *
 * The bridge to NEAT-AI-core's `creature_validate` — the shared source of truth
 * for creature validation (Issue #3803, core issues #559 / #562).
 *
 * The ABI is JSON in, JSON out: a whole creature does not fit the packed
 * scalar/buffer exports the rest of `WasmTopologyOps` uses, and a structured
 * failure is a record rather than a number. The request names the creature in
 * the **runtime** shape — every neuron listed, synapses wired by array position
 * — because that is the shape a host actually holds; the export wire form
 * cannot carry an input neuron's own id, an absent or non-finite bias, or a
 * malformed memetic record, and a validator that answers "healthy" for a
 * creature the rules reject is worse than no validator at all.
 *
 * ## Fail loud, never skip
 *
 * There is no TypeScript fallback. When the bundle cannot be loaded the call
 * throws a {@link WasmError} carrying the loader's own failure
 * ({@link getWasmLoadError}) as `cause`, so a creature can never be treated as
 * valid because validation did not run. The same applies to a `malformed`
 * answer: core is telling us the payload never reached a rule, which is a bug
 * in this bridge, not a verdict on the creature.
 */

import { WasmError } from "@errors/WasmError.ts";
import {
  getCreatureValidateFn,
  getWasmLoadError,
} from "@wasm/WasmModuleLoader.ts";

/** One neuron, exactly as the host holds it. */
export interface RuntimeNeuronPayload {
  /** Declared type, verbatim — an unknown one is core's to report. */
  type: string;
  /** Runtime id; `null` is JavaScript's `undefined`. */
  id: number | null;
  /** Wire identity, used by core's diagnostic labels. */
  uuid?: string;
  /** A number, a `"NaN"` / `"Infinity"` / `"-Infinity"` sentinel, or absent. */
  bias?: unknown;
  /** Activation function name. */
  squash?: string;
}

/**
 * One synapse, wired by neuron array position.
 *
 * `weight` is deliberately absent: no rule reads it, core defaults it away,
 * and on a creature with a thousand synapses it is roughly half the bytes both
 * sides spend on the payload.
 */
export interface RuntimeSynapsePayload {
  from: number;
  to: number;
  type?: string;
}

/** The creature half of a request. */
export interface RuntimeCreaturePayload {
  /** Declared observation count; `null` when it is not a finite number. */
  input: number | null;
  /** Declared target count, read the same way. */
  output: number | null;
  neurons: RuntimeNeuronPayload[];
  synapses: RuntimeSynapsePayload[];
  /** The memetic record, passed through verbatim. */
  memetic?: unknown;
}

/** The `options` half — every key optional, unknown keys refused by core. */
export interface ValidateOptionsPayload {
  neurons?: number;
  connections?: number;
  feedbackLoop?: boolean;
  forwardOnly?: boolean;
}

/** A whole request: one creature, and the options to validate it under. */
export interface CreatureValidateRequest {
  runtimeCreature: RuntimeCreaturePayload;
  options?: ValidateOptionsPayload;
}

/** The five counters `creatureValidate` returns. */
export interface CoreValidationStats {
  input: number;
  constant: number;
  hidden: number;
  output: number;
  connections: number;
}

/** The first violated rule, in the words the host rehydrates it with. */
export interface CoreValidationFailure {
  /** `"TopologyError"` or `"ValidationError"` — the class to rehydrate. */
  class: string;
  /** The verbatim `reason` union member. */
  reason: string;
  /** The human-readable message, reproduced from the TypeScript rules. */
  message: string;
  /** Neuron the rule stopped on; `null` when it was not a neuron rule. */
  neuronIndex: number | null;
  /** Synapse the rule stopped on; `null` when it was not a synapse rule. */
  synapseIndex: number | null;
}

/** What {@link coreValidateCreature} answers with. */
export interface CoreValidationResult {
  /** Present when the creature broke no rule. */
  stats?: CoreValidationStats;
  /** Present when it did. */
  failure?: CoreValidationFailure;
}

/** Message prefix core leads every boundary fault with. */
const MALFORMED_REQUEST = "MALFORMED_REQUEST:";

/**
 * Raise the loader's real failure rather than a generic "not loaded".
 *
 * Mirrors `requireWasm` in `WasmTopologyOps.ts`: a JSR consumer cannot
 * "run ./build.sh", so the underlying cause has to travel with the error.
 */
function bundleUnavailable(loadError: Error | null): WasmError {
  const cause = loadError
    ? `Underlying load error: ${loadError.name}: ${loadError.message}.`
    : `No underlying load error was recorded, so the WASM module was never ` +
      `initialised (auto-init may have been skipped or the process exited ` +
      `before it completed).`;
  return new WasmError(
    `creatureValidate requires the NEAT-AI-core WASM bundle, but it could ` +
      `not be loaded, and there is no TypeScript fallback — a creature must ` +
      `never be treated as valid because validation could not run. ${cause} ` +
      `If you are consuming @stsoftware/neat-ai from JSR, ensure the runtime ` +
      `can load the vendored bundle at wasm_activation/pkg. If you are ` +
      `developing NEAT-AI locally, run ./build.sh to refresh ` +
      `wasm_activation/pkg from the pinned core revision.`,
    "MODULE_NOT_LOADED",
    loadError ? { cause: loadError } : undefined,
  );
}

/** A record with the shape of an answer, or `null` when it is not one. */
function asRecord(value: unknown): Record<string, unknown> | null {
  return (typeof value === "object" && value !== null && !Array.isArray(value))
    ? value as Record<string, unknown>
    : null;
}

/**
 * Validate one creature through NEAT-AI-core.
 *
 * @param request The creature and the options, in the runtime request shape.
 * @param validateFn Injectable for testing an unavailable bundle; defaults to
 *   the loader's own pointer.
 * @param loadError Injectable for the same reason; defaults to the loader's
 *   recorded failure.
 * @returns The counters, or the first violated rule.
 * @throws {WasmError} When the bundle is unavailable (`MODULE_NOT_LOADED`), or
 *   when the payload never reached a rule (`INVALID_REQUEST`).
 */
export function coreValidateCreature(
  request: CreatureValidateRequest,
  validateFn: ((request: string) => string) | null = getCreatureValidateFn(),
  loadError: Error | null = getWasmLoadError(),
): CoreValidationResult {
  if (!validateFn) {
    throw bundleUnavailable(loadError);
  }

  const answer = validateFn(JSON.stringify(request));

  let parsed: unknown;
  try {
    parsed = JSON.parse(answer);
  } catch (error) {
    throw new WasmError(
      `creature_validate answered with something that is not JSON: ${answer}`,
      "INVALID_REQUEST",
      { cause: error instanceof Error ? error : undefined },
    );
  }

  const response = asRecord(parsed);
  if (!response) {
    throw new WasmError(
      `creature_validate answered with something that is not a response: ${answer}`,
      "INVALID_REQUEST",
    );
  }

  if (response.ok === true) {
    const stats = asRecord(response.stats);
    if (!stats) {
      throw new WasmError(
        `creature_validate reported a healthy creature with no counters: ${answer}`,
        "INVALID_REQUEST",
      );
    }
    return {
      stats: {
        input: stats.input as number,
        constant: stats.constant as number,
        hidden: stats.hidden as number,
        output: stats.output as number,
        connections: stats.connections as number,
      },
    };
  }

  const failure = asRecord(response.failure);
  if (!failure) {
    throw new WasmError(
      `creature_validate reported a failure with no detail: ${answer}`,
      "INVALID_REQUEST",
    );
  }

  const message = String(failure.message);
  // `malformed` says the payload never reached a rule, so it says nothing
  // about the creature. Reporting it as a validation failure would let a
  // bridge bug masquerade as a broken creature.
  if (failure.malformed === true || message.startsWith(MALFORMED_REQUEST)) {
    throw new WasmError(
      `creature_validate refused the request built for it: ${message}`,
      "INVALID_REQUEST",
    );
  }

  return {
    failure: {
      class: String(failure.class),
      reason: String(failure.reason),
      message,
      neuronIndex: typeof failure.neuronIndex === "number"
        ? failure.neuronIndex
        : null,
      synapseIndex: typeof failure.synapseIndex === "number"
        ? failure.synapseIndex
        : null,
    },
  };
}
