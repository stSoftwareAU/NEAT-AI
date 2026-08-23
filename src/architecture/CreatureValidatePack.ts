/**
 * @module
 *
 * Packs an in-memory {@link Creature} into the buffer NEAT-AI-core's
 * `creature_validate_packed` reads (Issue #3832).
 *
 * {@link module:src/architecture/CreatureValidateMarshal} builds the JSON
 * request, which is the shape a failure has to come back through. This module
 * builds the shape a creature should *go* in: on GRQ's 4 272-neuron,
 * 22 928-synapse production creature the JSON request is 850 KB, and
 * `JSON.stringify` alone costs 3.5 ms — more than the whole of the TypeScript
 * rules the WASM validator replaced. Validation runs after every mutation,
 * breed and discovery step, so that is paid on the hot path.
 *
 * The packed buffer carries the same creature as numbers: a header, five
 * per-neuron arrays and three per-synapse arrays, written straight into typed
 * array views over one `ArrayBuffer` and copied into linear memory as a single
 * `memcpy`. The layout is documented in core's `creature_validate_packed`
 * module and mirrored by the offsets below — the two must be read together.
 *
 * ## No strings, and what that costs
 *
 * Nothing here sends text. A neuron's `type`, `squash` and `uuid` travel as
 * codes and flags, which is most of what makes this cheap, and it is why a
 * packed answer can say "healthy, and here are the counters" but not "hidden
 * neuron `neuron-1803232510` has no outward connections". A broken creature
 * comes back as `detailRequired`, and the caller asks the JSON bridge for the
 * failure — see {@link module:src/architecture/CreatureValidate}.
 *
 * ## What must stay identical to the JSON marshal
 *
 * The two shapes describe the same creature, so the same in-memory value has
 * to reach the same rule either way. Three cases carry that weight, and each
 * is written here to match `CreatureValidateMarshal.ts` exactly:
 *
 * | In memory | Both shapes send |
 * |-----------|------------------|
 * | a non-finite or absent `bias` | the value itself; only a `bias` that is not a number at all reads as `undefined` |
 * | an `id` that is not a finite number | {@link NON_EXPRESSIBLE_ID}, which stops the walk on the same rule at the same neuron |
 * | an absent `id` | nothing — the flag says "no id" and rule 4 reports it |
 */

import type { Creature } from "@creature";
import { SQUASH_NAME_TO_TYPE } from "@wasm/SquashType.ts";
import type { CreatureValidateOptions } from "@architecture/CreatureValidateMarshal.ts";

/** `"NVAL"` little-endian — core refuses a buffer that opens with anything else. */
const PACKED_MAGIC = 0x4c41564e;

/** Layout revision. Advanced in lockstep with the vendored bundle. */
const PACKED_VERSION = 1;

/** Bytes before the first per-neuron array. */
const PACKED_HEADER_BYTES = 48;

/** The kind code for a `type` none of core's four rules recognise. */
const KIND_OTHER = 4;

/** The activation code for a name core cannot parse. */
const SQUASH_UNKNOWN = 255;

/** The `from` / `to` a synapse carries when its endpoint is not a position. */
const ENDPOINT_NONE = 0xffffffff;

/**
 * The id a neuron travels with when its own is not a finite number.
 *
 * The same placeholder `CreatureValidateMarshal.ts` substitutes, and for the
 * same reason: core's id rules are "an id exists" then "an id is an integer",
 * so a non-integer stops the walk on the second one at that neuron, before
 * anything else about it is read.
 */
const NON_EXPRESSIBLE_ID = 0.5;

/** Neuron kind codes, in core's order. */
const KIND_BY_TYPE: Record<string, number> = {
  input: 0,
  constant: 1,
  hidden: 2,
  output: 3,
};

/** Synapse role codes, in core's order. */
const ROLE_BY_TYPE: Record<string, number> = {
  condition: 1,
  negative: 2,
  positive: 3,
};

/** Option flag bits at offset 16. */
const OPTION_FORWARD_ONLY = 1 << 0;
const OPTION_FEEDBACK_LOOP_SET = 1 << 1;
const OPTION_FEEDBACK_LOOP_VALUE = 1 << 2;
const OPTION_NEURONS_SET = 1 << 3;
const OPTION_CONNECTIONS_SET = 1 << 4;

/** Neuron flag bits. */
const NEURON_HAS_ID = 1 << 0;
const NEURON_HAS_BIAS = 1 << 1;
const NEURON_HAS_SQUASH = 1 << 2;

/** Offset of the first per-synapse array, four-aligned as core computes it. */
function synapseSectionOffset(neuronCount: number): number {
  const unaligned = PACKED_HEADER_BYTES + neuronCount * 19;
  return (unaligned + 3) & ~3;
}

/**
 * Bytes a request for this many neurons and synapses occupies.
 *
 * Core computes the same length from the header it reads back and refuses a
 * buffer of any other size, so this is the one place the arithmetic lives on
 * this side.
 */
export function packedRequestLength(
  neuronCount: number,
  synapseCount: number,
): number {
  return synapseSectionOffset(neuronCount) + synapseCount * 9;
}

/**
 * The buffer the last pack used, reused by the next one that fits.
 *
 * Packing GRQ's production creature needs ~300 KB, and `creatureValidate` runs
 * after every mutation. Allocating that per call is pure garbage: the buffer is
 * filled and handed to WASM — which copies it into linear memory — inside one
 * synchronous call, so nothing can observe it between packs.
 */
let scratch: ArrayBuffer = new ArrayBuffer(0);

/** The scratch buffer, grown if this request needs more than the last one did. */
function scratchFor(byteLength: number): ArrayBuffer {
  if (scratch.byteLength < byteLength) {
    scratch = new ArrayBuffer(byteLength);
  }
  return scratch;
}

/**
 * Pack one creature and its options into the request core reads.
 *
 * @param creature The creature to describe, exactly as it is held in memory.
 * @param options The `creatureValidate` options, passed through unchanged.
 * @returns A view over the scratch buffer, valid until the next pack. Hand it
 *   straight to the WASM call rather than holding on to it.
 */
export function packCreatureValidateRequest(
  creature: Creature,
  options?: CreatureValidateOptions,
): Uint8Array {
  const neurons = creature.neurons;
  const synapses = creature.synapses;
  const neuronCount = neurons.length;
  const synapseCount = synapses.length;
  const byteLength = packedRequestLength(neuronCount, synapseCount);

  const buffer = scratchFor(byteLength);
  const request = new Uint8Array(buffer, 0, byteLength);
  // A grown buffer is zeroed by the runtime, a reused one is not: every byte
  // below is written unconditionally except the id, bias and activation of a
  // neuron whose flag says it carries none — which core does not read.
  const header = new DataView(buffer, 0, PACKED_HEADER_BYTES);

  header.setUint32(0, PACKED_MAGIC, true);
  header.setUint32(4, PACKED_VERSION, true);
  header.setUint32(8, neuronCount, true);
  header.setUint32(12, synapseCount, true);
  header.setUint32(16, optionBits(header, options), true);
  header.setUint32(28, 0, true);
  header.setFloat64(32, numberOrNaN(creature.input), true);
  header.setFloat64(40, numberOrNaN(creature.output), true);

  const idsAt = PACKED_HEADER_BYTES;
  const biasesAt = idsAt + neuronCount * 8;
  const kindsAt = biasesAt + neuronCount * 8;
  const flagsAt = kindsAt + neuronCount;
  const squashAt = flagsAt + neuronCount;

  const ids = new Float64Array(buffer, idsAt, neuronCount);
  const biases = new Float64Array(buffer, biasesAt, neuronCount);
  const kinds = new Uint8Array(buffer, kindsAt, neuronCount);
  const flags = new Uint8Array(buffer, flagsAt, neuronCount);
  const squashCodes = new Uint8Array(buffer, squashAt, neuronCount);

  for (let indx = 0; indx < neuronCount; indx++) {
    const neuron = neurons[indx];
    let neuronFlags = 0;

    const rawId: unknown = neuron.id;
    if (typeof rawId === "number" && Number.isFinite(rawId)) {
      ids[indx] = rawId;
      neuronFlags |= NEURON_HAS_ID;
    } else if (rawId !== undefined && rawId !== null) {
      // Not a number core can read back as the id it is — the same
      // substitution the JSON marshal makes, reaching the same rule.
      ids[indx] = NON_EXPRESSIBLE_ID;
      neuronFlags |= NEURON_HAS_ID;
    }

    const rawBias: unknown = neuron.bias;
    if (typeof rawBias === "number") {
      // Non-finite biases travel as themselves; rule 8 is what rejects them.
      biases[indx] = rawBias;
      neuronFlags |= NEURON_HAS_BIAS;
    }

    const squash = neuron.squash;
    if (squash !== undefined && squash !== null) {
      squashCodes[indx] = SQUASH_NAME_TO_TYPE[squash] ?? SQUASH_UNKNOWN;
      neuronFlags |= NEURON_HAS_SQUASH;
    } else {
      squashCodes[indx] = SQUASH_UNKNOWN;
    }

    kinds[indx] = KIND_BY_TYPE[neuron.type] ?? KIND_OTHER;
    flags[indx] = neuronFlags;
  }

  const fromAt = synapseSectionOffset(neuronCount);
  const toAt = fromAt + synapseCount * 4;
  const rolesAt = toAt + synapseCount * 4;

  const fromIndices = new Uint32Array(buffer, fromAt, synapseCount);
  const toIndices = new Uint32Array(buffer, toAt, synapseCount);
  const roles = new Uint8Array(buffer, rolesAt, synapseCount);

  for (let indx = 0; indx < synapseCount; indx++) {
    const synapse = synapses[indx];
    fromIndices[indx] = endpoint(synapse.from, neuronCount);
    toIndices[indx] = endpoint(synapse.to, neuronCount);
    const role = synapse.type;
    roles[indx] = role === undefined ? 0 : ROLE_BY_TYPE[role] ?? 0;
  }

  return request;
}

/**
 * The creature's memetic record as JSON, or `""` when it carries none.
 *
 * The record is irregular, optional and small — five entries on the creature
 * that motivated this module — so it travels alongside the buffer rather than
 * inside it, in the same JSON form the runtime request already sends.
 */
export function packedMemetic(creature: Creature): string {
  const memetic = creature.memetic;
  return memetic === undefined ? "" : JSON.stringify(wireDeep(memetic));
}

/** Deep copy with every non-finite number replaced by the sentinel core reads. */
function wireDeep(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(wireDeep);
  if (typeof value === "object" && value !== null) {
    const copy: Record<string, unknown> = {};
    for (const [key, member] of Object.entries(value)) {
      copy[key] = wireDeep(member);
    }
    return copy;
  }
  if (typeof value !== "number" || Number.isFinite(value)) return value;
  if (Number.isNaN(value)) return "NaN";
  return value > 0 ? "Infinity" : "-Infinity";
}

/** Write the option values, and answer with the flags that say they are there. */
function optionBits(
  header: DataView,
  options?: CreatureValidateOptions,
): number {
  header.setUint32(20, 0, true);
  header.setUint32(24, 0, true);
  if (!options) return 0;

  let bits = 0;
  if (options.forwardOnly === true) bits |= OPTION_FORWARD_ONLY;
  if (options.feedbackLoop !== undefined) {
    bits |= OPTION_FEEDBACK_LOOP_SET;
    if (options.feedbackLoop) bits |= OPTION_FEEDBACK_LOOP_VALUE;
  }
  if (options.neurons !== undefined) {
    bits |= OPTION_NEURONS_SET;
    header.setUint32(20, options.neurons, true);
  }
  if (options.connections !== undefined) {
    bits |= OPTION_CONNECTIONS_SET;
    header.setUint32(24, options.connections, true);
  }
  return bits;
}

/** A finite number as itself, and everything JSON has no literal for as `NaN`. */
function numberOrNaN(value: unknown): number {
  return typeof value === "number" ? value : Number.NaN;
}

/**
 * A synapse endpoint as the buffer carries it.
 *
 * A `Uint32Array` write would truncate `1.5` to `1` and wrap `-1` round to the
 * sentinel, so anything that is not an array position is made the sentinel
 * here rather than becoming a different neuron's index. Core reports it as the
 * endpoint that names no neuron.
 */
function endpoint(position: number, neuronCount: number): number {
  return Number.isInteger(position) && position >= 0 && position < neuronCount
    ? position
    : ENDPOINT_NONE;
}
