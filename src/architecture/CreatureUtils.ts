import { generate as generateV5Sync } from "@architecture/SyncV5.ts";
import type { Creature } from "@creature";
import { ValidationError } from "@errors/ValidationError.ts";
import { neuronUuid } from "@neuron/NeuronSerialization.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";

/**
 * Utility class for Creature-related operations.
 *
 * Provides static methods for common operations on Creature instances,
 * including UUID generation and array manipulation utilities.
 *
 * Key features:
 * - UUID generation for creatures based on their structure
 * - Array shuffling utilities
 * - Consistent creature identification
 *
 * @example
 * ```ts
 * const uuid = CreatureUtil.makeUUID(creature);
 * CreatureUtil.shuffle(array);
 * ```
 */
export class CreatureUtil {
  /** Text encoder for UUID generation */
  private static TE = new TextEncoder();
  /** UUID namespace for creature UUID generation */
  private static NAMESPACE = "843dc7df-f60b-47f6-823d-2992e0a4295c";
  /** UUID namespace for topology hash generation (different from full UUID) */
  private static TOPOLOGY_NAMESPACE = "a1b2c3d4-e5f6-47a8-9b0c-d1e2f3a4b5c6";

  /**
   * Shuffle an array in place using the Fisher-Yates shuffle algorithm.
   *
   * This method modifies the original array by randomly reordering its elements.
   * The shuffle is performed in-place for memory efficiency.
   *
   * @param array - The array to be shuffled
   */
  static shuffle(array: Int32Array): void {
    if (array.length > 1) {
      const rng = getRandomNumberGenerator();
      for (let i = array.length; i--;) {
        const j = Math.round(rng.random() * i);
        [array[i], array[j]] = [array[j], array[i]];
      }
    }
  }

  /**
   * Generate a UUID for a creature based on its neurons and synapses.
   *
   * Creates a deterministic UUID based on the creature's neural network structure.
   * The UUID is generated from a sorted representation of neurons and synapses,
   * ensuring that structurally identical creatures receive the same UUID.
   *
   * If the creature already has a UUID, it returns the existing one.
   *
   * @param creature - The creature for which to generate the UUID
   * @returns The generated UUID string
   * @throws {Error} When the creature is invalid or missing required properties
   *
   * @example
   * ```ts
   * const uuid = CreatureUtil.makeUUID(creature);
   * getLogger().info(`Creature UUID: ${uuid}`);
   * ```
   */
  static makeUUID(creature: Creature): string {
    if (creature.uuid) {
      return creature.uuid;
    }

    if (!creature.synapses || !creature.neurons) {
      throw new ValidationError(
        "Not a creature: " + (typeof creature),
        "OTHER",
      );
    }
    const holdDebug = creature.DEBUG;
    try {
      creature.DEBUG = false;
      const json = creature.exportJSON();

      // Sort by stable wire-format uuid (integer ids are not exported)
      json.neurons.sort((a, b) => (a.uuid ?? "").localeCompare(b.uuid ?? ""));
      json.synapses.sort((a, b) => {
        const fc = (a.fromUUID ?? "").localeCompare(b.fromUUID ?? "");
        if (fc !== 0) return fc;
        return (a.toUUID ?? "").localeCompare(b.toUUID ?? "");
      });

      // Remove tags for UUID generation consistency
      json.neurons.forEach((n) => delete n.tags);
      json.synapses.forEach((s) => delete s.tags);

      const tmp = {
        neurons: json.neurons,
        synapses: json.synapses,
      };

      const txt = JSON.stringify(tmp);
      const utf8 = CreatureUtil.TE.encode(txt);
      const uuid: string = generateV5Sync(CreatureUtil.NAMESPACE, utf8);

      creature.uuid = uuid;
      return uuid;
    } finally {
      creature.DEBUG = holdDebug;
    }
  }

  /**
   * Generate a topology hash for a creature based on its structure only.
   *
   * Creates a deterministic hash based on the creature's neural network topology,
   * ignoring weights and biases. This enables identification of creatures with
   * identical structure regardless of their learned parameters.
   *
   * Issue #1016: Performance optimisation for evaluation deduplication.
   * Issue #2257: Computes the hash directly from the creature's internal
   * neuron and synapse arrays, avoiding a full `exportJSON()` call. This
   * eliminates one of the two redundant exports that previously occurred
   * per creature during fitness evaluation (topology sort + worker
   * postMessage).
   *
   * Issue #2301: Include `creature.input` in the hash so that creatures
   * with different input counts produce distinct hashes, preventing
   * WASM compilation cache collisions after Upgrade.correct().
   *
   * The hash is based on:
   * - Input count (`creature.input`)
   * - Neuron UUIDs, types, and squash functions
   * - Synapse connection patterns (fromUUID -> toUUID pairs)
   * - NOT weights, biases, or tags
   *
   * @param creature - The creature for which to generate the topology hash
   * @returns The generated topology hash string
   * @throws {Error} When the creature is invalid or missing required properties
   *
   * @example
   * ```ts
   * const hash = CreatureUtil.getTopologyHash(creature);
   * getLogger().info(`Creature topology hash: ${hash}`);
   * ```
   */
  static getTopologyHash(creature: Creature): string {
    if (creature.topologyHash) {
      return creature.topologyHash;
    }

    if (!creature.synapses || !creature.neurons) {
      throw new ValidationError(
        "Not a creature: " + (typeof creature),
        "OTHER",
      );
    }

    const neurons = creature.neurons;
    const synapses = creature.synapses;
    const neuronsLength = neurons.length;
    const synapsesLength = synapses.length;
    const inputCount = creature.input;

    // Issue #2258: Reuse cached neuron topology key and UUID lookup array
    // when only connections have changed (neurons unchanged).
    let neuronKey = creature._cachedNeuronTopologyKey;
    let uuids = creature._cachedUuidLookup;

    if (neuronKey === undefined || uuids === undefined) {
      // Build index-to-UUID lookup array (faster than Map).
      uuids = new Array<string>(neuronsLength);
      for (let i = 0; i < neuronsLength; i++) {
        const neuron = neurons[i];
        if (neuron.type === "input") {
          uuids[i] = `input-${i}`;
        } else {
          uuids[i] = neuronUuid(neuron);
        }
      }

      // Build sorted neuron topology key strings (non-input only).
      const neuronKeys = new Array<string>(neuronsLength - inputCount);
      for (let i = inputCount; i < neuronsLength; i++) {
        const neuron = neurons[i];
        neuronKeys[i - inputCount] = uuids[i] + "\t" + neuron.type + "\t" +
          (neuron.squash || "");
      }
      neuronKeys.sort();
      neuronKey = neuronKeys.join("\n");

      // Cache for reuse across connection-only changes.
      creature._cachedNeuronTopologyKey = neuronKey;
      creature._cachedUuidLookup = uuids;
    }

    // Build sorted synapse topology key strings.
    const synapseKeys = new Array<string>(synapsesLength);
    for (let i = 0; i < synapsesLength; i++) {
      const synapse = synapses[i];
      synapseKeys[i] = uuids[synapse.from] + "\t" + uuids[synapse.to];
    }
    synapseKeys.sort();

    // Issue #2301: Include the input count so that creatures with different
    // input counts (e.g. after Upgrade.correct()) produce distinct hashes.
    // Without this, the WASM compilation cache can serve a template compiled
    // for a different numInputs, causing activation errors.
    const txt = inputCount + "\n" + neuronKey + "\n\n" + synapseKeys.join("\n");
    const utf8 = CreatureUtil.TE.encode(txt);
    const hash: string = generateV5Sync(
      CreatureUtil.TOPOLOGY_NAMESPACE,
      utf8,
    );

    creature.topologyHash = hash;
    return hash;
  }
}
