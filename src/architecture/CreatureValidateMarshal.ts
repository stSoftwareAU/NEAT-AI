/**
 * @module
 *
 * Marshals an in-memory {@link Creature} into the request NEAT-AI-core's
 * `creature_validate` reads (Issue #3803).
 *
 * The runtime request shape is deliberately close to what the host already
 * holds — every neuron listed in position order, synapses wired by array
 * position — so nothing is derived on the way across and nothing can be
 * derived away. Three values still need care, because JSON has no literal for
 * them:
 *
 * | Value | On the wire |
 * |-------|-------------|
 * | a non-finite `bias` or synapse `weight` | the `"NaN"` / `"Infinity"` / `"-Infinity"` sentinel strings core reads |
 * | an absent `id`, `bias` or `squash` | `null` / omitted, which core reads as `undefined` |
 * | an `id` that is not a finite number at all | a non-integer placeholder, restored by {@link restoreSubstitutedId} |
 *
 * ## Why an id can need restoring
 *
 * `Neuron.id` is declared `number`, so core types the wire field as a JSON
 * number. A corrupt in-memory creature can still carry a string, a `NaN` or an
 * `Infinity` there — NEAT-AI's own tests build exactly that — and none of them
 * survives the wire. Substituting a **non-integer** placeholder puts the walk
 * on the identical rule (an id that is not an integer) at the identical
 * neuron, so ordering is preserved exactly; the placeholder is then swapped
 * back out of the message on the way home. That is marshalling symmetry, not a
 * translation of core's rules: the rule, the class and the reason all come
 * from core untouched, and only the value this side could not send is put
 * back.
 */

import type { Creature } from "@creature";
import type { Neuron } from "@architecture/Neuron.ts";
import type {
  CreatureValidateRequest,
  RuntimeNeuronPayload,
  RuntimeSynapsePayload,
  ValidateOptionsPayload,
} from "@wasm/WasmCreatureValidate.ts";

/** The options `creatureValidate` accepts. */
export interface CreatureValidateOptions {
  neurons?: number;
  connections?: number;
  /**
   * When false, recursive (back) synapses are rejected.
   * When true/undefined, recursive synapses are allowed.
   */
  feedbackLoop?: boolean;
  /**
   * Convenience option for production feed-forward validation.
   * When true, all recurrent connections are rejected (both feedback/backward
   * synapses and self-loops).
   */
  forwardOnly?: boolean;
}

/** A request, plus the ids that could not be sent as they stand. */
export interface MarshalledRequest {
  readonly request: CreatureValidateRequest;
  /** Neuron index → `String(neuron.id)`, for the ids replaced by a placeholder. */
  readonly substitutedIds: Map<number, string>;
}

/**
 * The placeholder a non-expressible id travels as.
 *
 * Any non-integer number would do: core's id rules are "an id exists" then "an
 * id is an integer", so a non-integer stops the walk on the second one at that
 * neuron, before anything else about it is read.
 */
const NON_EXPRESSIBLE_ID = 0.5;

/** A finite number, or `null` for everything JSON cannot carry as one. */
function finiteOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

/**
 * A value core can read back as the number it is: finite numbers travel as
 * themselves, non-finite ones as the sentinel strings, and anything else
 * verbatim (core reads an unusable bias as `undefined`, which is what it is).
 */
function wireValue(value: unknown): unknown {
  if (typeof value !== "number" || Number.isFinite(value)) {
    return value;
  }
  if (Number.isNaN(value)) return "NaN";
  return value > 0 ? "Infinity" : "-Infinity";
}

/** Deep copy with every non-finite number replaced by its sentinel. */
function wireDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wireDeep);
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      copy[key] = wireDeep(member);
    }
    return copy;
  }
  return wireValue(value);
}

function marshalNeuron(
  neuron: Neuron,
  indx: number,
  substitutedIds: Map<number, string>,
): RuntimeNeuronPayload {
  const rawId: unknown = neuron.id;
  let id: number | null;
  if (typeof rawId === "number" && Number.isFinite(rawId)) {
    id = rawId;
  } else if (rawId === undefined || rawId === null) {
    // Core reads `null` as `undefined` and reports "no id".
    id = null;
  } else {
    id = NON_EXPRESSIBLE_ID;
    substitutedIds.set(indx, String(rawId));
  }

  return {
    // `String` keeps an absent type expressible: core reports
    // `Invalid type: undefined` exactly as the TypeScript rules did.
    type: String(neuron.type),
    id,
    uuid: neuron.uuid,
    bias: wireValue(neuron.bias),
    squash: neuron.squash,
  };
}

function marshalSynapse(synapse: {
  from: number;
  to: number;
  weight: number;
  type?: string;
}): RuntimeSynapsePayload {
  return {
    from: synapse.from,
    to: synapse.to,
    weight: wireValue(synapse.weight),
    type: synapse.type,
  };
}

/** Only the four keys core accepts; an unknown one is a boundary fault there. */
function marshalOptions(
  options?: CreatureValidateOptions,
): ValidateOptionsPayload | undefined {
  if (!options) return undefined;
  const payload: ValidateOptionsPayload = {};
  if (options.neurons !== undefined) payload.neurons = options.neurons;
  if (options.connections !== undefined) {
    payload.connections = options.connections;
  }
  if (options.feedbackLoop !== undefined) {
    payload.feedbackLoop = options.feedbackLoop;
  }
  if (options.forwardOnly !== undefined) {
    payload.forwardOnly = options.forwardOnly;
  }
  return payload;
}

/**
 * Build the `creature_validate` request for one creature.
 *
 * @param creature The creature to describe, exactly as it is held in memory.
 * @param options The `creatureValidate` options, passed through unchanged.
 */
export function marshalCreatureValidateRequest(
  creature: Creature,
  options?: CreatureValidateOptions,
): MarshalledRequest {
  const substitutedIds = new Map<number, string>();
  const request: CreatureValidateRequest = {
    runtimeCreature: {
      input: finiteOrNull(creature.input),
      output: finiteOrNull(creature.output),
      neurons: creature.neurons.map((neuron, indx) =>
        marshalNeuron(neuron, indx, substitutedIds)
      ),
      synapses: creature.synapses.map(marshalSynapse),
      memetic: creature.memetic === undefined
        ? undefined
        : wireDeep(creature.memetic),
    },
    options: marshalOptions(options),
  };

  return { request, substitutedIds };
}

/**
 * Put a substituted id back into the message core built from the placeholder.
 *
 * Core's message for a non-integer id is `` `${id}) invalid neuron id: ${id}` ``
 * and the walk cannot get past that rule at a substituted neuron, so a failure
 * reported there is always that rule — the real id simply takes the
 * placeholder's place.
 *
 * @returns The message to throw, unchanged when nothing was substituted there.
 */
export function restoreSubstitutedId(
  message: string,
  neuronIndex: number | null,
  substitutedIds: Map<number, string>,
): string {
  if (neuronIndex === null) return message;
  const original = substitutedIds.get(neuronIndex);
  if (original === undefined) return message;
  return `${original}) invalid neuron id: ${original}`;
}
