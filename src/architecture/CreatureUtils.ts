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
   * Issue #3843: scratch used to read a double's bit pattern without
   * allocating. `FP_I32` aliases `FP_F64`'s buffer, so writing a bias or
   * weight into `FP_F64[0]` exposes its exact 64 bits as two int32 words —
   * making the fingerprint sensitive to changes far below any printed
   * precision.
   */
  private static FP_F64 = new Float64Array(1);
  private static FP_I32 = new Int32Array(CreatureUtil.FP_F64.buffer);

  /** FNV-1a / murmur3 mixing constants for the two fingerprint words. */
  private static FP_PRIME_A = 0x01000193;
  private static FP_PRIME_B = 0x85ebca6b;

  /**
   * Issue #3843: the words written by the most recent
   * {@link computeFingerprint} call. Two independent 32-bit accumulators give
   * a 64-bit fingerprint without allocating a tuple or a string on what is a
   * per-creature, per-generation path.
   */
  private static fpA = 0;
  private static fpB = 0;

  /**
   * Compute the creature's content fingerprint into {@link fpA} / {@link fpB}.
   *
   * Issue #3843: a cheap, allocation-free pass over exactly what
   * {@link makeUUID} hashes — neuron count, synapse count, input/output
   * counts, and per neuron/synapse the bias, weight, squash, neuron uuid,
   * endpoints, synapse role and frozen flag. It is O(neurons + synapses) with
   * no string building, no sort and no digest, so it costs a small fraction of
   * the hash it guards (see the Issue #2308 note on {@link makeUUID}).
   *
   * This is a change detector, not a digest: it never replaces the v5 uuid,
   * it only decides whether the cached one may still be trusted. Any
   * disagreement forces a full recomputation, so a false positive costs time
   * and nothing else.
   */
  private static computeFingerprint(creature: Creature): void {
    const f64 = CreatureUtil.FP_F64;
    const i32 = CreatureUtil.FP_I32;
    const primeA = CreatureUtil.FP_PRIME_A;
    const primeB = CreatureUtil.FP_PRIME_B;
    const neurons = creature.neurons;
    const synapses = creature.synapses;
    const neuronsLength = neurons.length;
    const synapsesLength = synapses.length;
    const inputCount = creature.input;

    let a = Math.imul(0x811c9dc5 ^ neuronsLength, primeA);
    let b = Math.imul(0x9e3779b9 ^ synapsesLength, primeB);
    a = Math.imul(a ^ inputCount, primeA);
    b = Math.imul(b ^ creature.output, primeB);

    for (let i = inputCount; i < neuronsLength; i++) {
      const neuron = neurons[i];

      f64[0] = neuron.bias;
      a = Math.imul(a ^ i32[0], primeA);
      b = Math.imul(b ^ i32[1], primeB);
      a = Math.imul(a ^ i32[1], primeA);
      b = Math.imul(b ^ i32[0], primeB);

      const squash = neuron.squash;
      if (squash !== undefined) {
        for (let c = squash.length; c--;) {
          const code = squash.charCodeAt(c);
          a = Math.imul(a ^ code, primeA);
          b = Math.imul(b ^ code, primeB);
        }
      }

      // A neuron's uuid is immutable, but a pass may swap one neuron for
      // another at the same index — the identity must move with it.
      const uuid = neuron.uuid;
      if (uuid !== undefined) {
        for (let c = uuid.length; c--;) {
          const code = uuid.charCodeAt(c);
          a = Math.imul(a ^ code, primeA);
          b = Math.imul(b ^ code, primeB);
        }
      }

      // `input`/`output`/`hidden`/`constant` differ in their first character.
      // An output neuron's makeUUID key is `output-N`, derived from its id, so
      // the id belongs in the fingerprint as well.
      const flags = (neuron.frozen ? 1 : 0) | (neuron.type.charCodeAt(0) << 1) |
        (neuron.id << 8);
      a = Math.imul(a ^ flags, primeA);
      b = Math.imul(b ^ flags, primeB);
    }

    for (let i = 0; i < synapsesLength; i++) {
      const synapse = synapses[i];

      f64[0] = synapse.weight;
      a = Math.imul(a ^ i32[0], primeA);
      b = Math.imul(b ^ i32[1], primeB);
      a = Math.imul(a ^ i32[1], primeA);
      b = Math.imul(b ^ i32[0], primeB);

      a = Math.imul(a ^ synapse.from, primeA);
      b = Math.imul(b ^ synapse.from, primeB);
      a = Math.imul(a ^ synapse.to, primeA);
      b = Math.imul(b ^ synapse.to, primeB);

      // `condition`/`positive`/`negative` differ in their first character.
      const type = synapse.type;
      const flags = (synapse.frozen ? 1 : 0) |
        (type === undefined ? 0 : type.charCodeAt(0) << 1);
      a = Math.imul(a ^ flags, primeA);
      b = Math.imul(b ^ flags, primeB);
    }

    CreatureUtil.fpA = a;
    CreatureUtil.fpB = b;
  }

  /**
   * Shuffle an array in place using the Fisher-Yates shuffle algorithm.
   *
   * This method modifies the original array by randomly reordering its elements.
   * The shuffle is performed in-place for memory efficiency.
   *
   * @param array - The array to be shuffled
   * @param length - Optional number of leading elements to shuffle. Defaults to
   *   the full array length. Lets callers shuffle a pooled buffer's used slice
   *   without allocating a `subarray` view (Issue #3087).
   */
  static shuffle(array: Int32Array, length: number = array.length): void {
    if (length > 1) {
      const rng = getRandomNumberGenerator();
      for (let i = length; i--;) {
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
   * Issue #3843: a cached UUID is returned only while it still matches the
   * creature's content. This method used to short-circuit on any cached value,
   * which made a content-derived identity depend on all ~26 mutation sites
   * remembering to `delete creature.uuid` — and one that forgets is not
   * cosmetic, because `Fitness` deduplicates the evaluation queue by uuid and
   * copies the representative's score onto every "duplicate". A creature whose
   * structure moved but whose uuid did not is then handed a score it never
   * earned. The cached value is now guarded by a cheap content fingerprint
   * ({@link computeFingerprint}) so a forgotten `delete` can no longer hand out
   * a stale identity. A uuid that did not come from this method (loaded from
   * JSON, copied onto a clone) carries no fingerprint and is verified by
   * recomputation on first use.
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
    if (!creature.synapses || !creature.neurons) {
      throw new ValidationError(
        "Not a creature: " + (typeof creature),
        "OTHER",
      );
    }

    // Issue #3843: trust the cached uuid only while the content it was derived
    // from is unchanged.
    CreatureUtil.computeFingerprint(creature);
    if (
      creature.uuid &&
      creature.uuidFingerprintA === CreatureUtil.fpA &&
      creature.uuidFingerprintB === CreatureUtil.fpB
    ) {
      return creature.uuid;
    }

    // Issue #2308: Build the UUID hash string directly from the creature's
    // internal arrays instead of calling the expensive exportJSON() path.
    // This avoids allocating intermediate NeuronExport/SynapseExport objects,
    // building UUID/ID maps, and JSON.stringify overhead. At production scale
    // (~1,500 neurons, ~20,000 synapses) this reduces makeUUID cost from
    // ~18 ms to ~3 ms.
    const neurons = creature.neurons;
    const synapses = creature.synapses;
    const neuronsLength = neurons.length;
    const synapsesLength = synapses.length;
    const inputCount = creature.input;

    // Build index-to-UUID lookup array (reuse from topology hash if available).
    // Issue #3843: the cache is invalidated by `clearCache()`; a length
    // disagreement means neurons were added or removed without one, so rebuild
    // rather than hash `undefined` endpoints.
    let uuids = creature._cachedUuidLookup;
    if (uuids === undefined || uuids.length !== neuronsLength) {
      uuids = new Array<string>(neuronsLength);
      for (let i = 0; i < neuronsLength; i++) {
        const neuron = neurons[i];
        if (neuron.type === "input") {
          uuids[i] = `input-${i}`;
        } else {
          uuids[i] = neuronUuid(neuron);
        }
      }
      creature._cachedUuidLookup = uuids;
    }

    // Build sorted neuron identity strings (non-input only).
    // Includes uuid, type, bias, squash, and frozen — everything that
    // distinguishes one creature from another (tags excluded for consistency).
    const neuronKeys = new Array<string>(neuronsLength - inputCount);
    for (let i = inputCount; i < neuronsLength; i++) {
      const neuron = neurons[i];
      neuronKeys[i - inputCount] = uuids[i] + "\t" + neuron.type + "\t" +
        neuron.bias + "\t" + (neuron.squash || "") + "\t" +
        (neuron.frozen ? "1" : "");
    }
    neuronKeys.sort();

    // Build sorted synapse identity strings.
    // Includes fromUUID, toUUID, weight, type, and frozen.
    const synapseKeys = new Array<string>(synapsesLength);
    for (let i = 0; i < synapsesLength; i++) {
      const synapse = synapses[i];
      synapseKeys[i] = uuids[synapse.from] + "\t" + uuids[synapse.to] + "\t" +
        synapse.weight + "\t" + (synapse.type || "") + "\t" +
        (synapse.frozen ? "1" : "");
    }
    synapseKeys.sort();

    const txt = neuronKeys.join("\n") + "\n\n" + synapseKeys.join("\n");
    const utf8 = CreatureUtil.TE.encode(txt);
    const uuid: string = generateV5Sync(CreatureUtil.NAMESPACE, utf8);

    creature.uuid = uuid;
    // Issue #3843: stamp the content this uuid was derived from. Nothing above
    // mutates the creature, so the words computed on entry still describe it.
    creature.uuidFingerprintA = CreatureUtil.fpA;
    creature.uuidFingerprintB = CreatureUtil.fpB;
    return uuid;
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
   * Issue #2670: Preserve neuron position order in the hash. The WASM
   * compilation cache template encodes synapse `from_index` and per-neuron
   * `squash` byte by integer position in `creature.neurons`, so two
   * creatures that share the same UUID-set + UUID→UUID synapse-set but
   * differ in topological ordering would previously collide in the hash
   * and have one creature's stale template served to the other — tripping
   * a `RuntimeError: unreachable` inside `CompiledNetwork::new`. Including
   * the position order makes the hash one-to-one with the binary template.
   *
   * Issue #3840: Include each synapse's `type` — the `IF` role
   * (`condition` / `positive` / `negative`). The compiled template encodes it
   * as the `synapse_type` byte, so omitting it let two creatures that differ
   * only in which branch an edge feeds share a template: the second creature
   * was then activated with the first creature's routing. Appended only when
   * the role is present, so creatures with no typed synapse hash unchanged.
   *
   * The hash is based on:
   * - Input count (`creature.input`)
   * - Neuron UUIDs, types, and squash functions **in position order**
   * - Synapse connection patterns (fromUUID -> toUUID pairs) and roles
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

      // Build neuron topology key strings in position order (non-input only).
      // Issue #2670: Position order is intentional — see the docstring above.
      // The WASM template encodes by integer position, so two creatures with
      // the same UUID-set but a different topological ordering must hash to
      // different values to avoid stale cached templates trapping the WASM
      // constructor with `RuntimeError: unreachable`.
      const neuronKeys = new Array<string>(neuronsLength - inputCount);
      for (let i = inputCount; i < neuronsLength; i++) {
        const neuron = neurons[i];
        neuronKeys[i - inputCount] = uuids[i] + "\t" + neuron.type + "\t" +
          (neuron.squash || "");
      }
      neuronKey = neuronKeys.join("\n");

      // Cache for reuse across connection-only changes.
      creature._cachedNeuronTopologyKey = neuronKey;
      creature._cachedUuidLookup = uuids;
    }

    // Build sorted synapse topology key strings.
    //
    // Issue #3840: the synapse `type` (an `IF` neuron's `condition` /
    // `positive` / `negative` role) is part of the compiled template — see the
    // `synapse_type` u8 in CompileToWasm — but was absent from this key. Two
    // creatures whose only difference was which branch an edge feeds therefore
    // shared a cache entry, and `compileFromTemplate` patched the second
    // creature's weights into the first creature's *routing*. The role is
    // appended only when present, so a creature with no typed synapse hashes
    // exactly as it did before and no cache entry churns.
    const synapseKeys = new Array<string>(synapsesLength);
    for (let i = 0; i < synapsesLength; i++) {
      const synapse = synapses[i];
      const key = uuids[synapse.from] + "\t" + uuids[synapse.to];
      synapseKeys[i] = synapse.type === undefined
        ? key
        : key + "\t" + synapse.type;
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
