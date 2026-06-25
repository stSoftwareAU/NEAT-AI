/**
 * @module
 *
 * Builds offspring creatures from two parents for the breeding pipeline —
 * crossover of topology, synapses and hyperparameters. Neurons are aligned
 * between parents by matching stable UUIDs (never array position), so the same
 * genome breeds consistently across machines; child neurons keep their parent
 * UUID and any newly created neurons get a fresh one.
 */
import { assert } from "@std/assert";
import { addTags } from "@stsoftware/tags/mod";
import { memeticUpdate } from "@blackbox/MemeticUpdate.ts";
import { editParentByIndex } from "@breed/EditParentByIndex.ts";
import { geneticCompatibility } from "@breed/GeneticCompatibility.ts";
import { Creature } from "@creature";
import type { RequiredHyperparameterEvolutionConfig } from "@config/HyperparameterConfig.ts";
import { DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG } from "@config/HyperparameterConfig.ts";
import { crossoverHyperparameters } from "@neat/HyperparameterEvolution.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import { neuronWireLabelForDiagnostics } from "@neuron/NeuronSerialization.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { prepareCreatureForBreeding } from "@upgrade/Upgrade.ts";
import { writeDiagnostics } from "@utils/Diagnostics.ts";
import { getLogger } from "@utils/Logger.ts";
import { inputWeightCrossover } from "@breed/InputWeightCrossover.ts";
import { subgraphTransplant } from "@breed/SubgraphTransplant.ts";
import { restoreGraftAliases } from "@breed/RestoreGraftAliases.ts";
import { pruneOrphanMemeticReferences } from "@compact/CompactUtils.ts";
import type { BreedingSubPhaseAccumulator } from "@breed/BreedingSubPhaseAccumulator.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Neuron } from "@architecture/Neuron.ts";
import { outputIndexFromId, outputNeuronId } from "@architecture/NeuronId.ts";
import { Synapse as SynapseClass } from "@architecture/Synapse.ts";
import type {
  SynapseExport,
  SynapseInternal,
} from "@architecture/SynapseInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { assertForwardOnlyTopologyAfterBulkRemap } from "@architecture/ForwardOnlySynapseGuard.ts";
import {
  runProducerCompileProbe,
  setProducerStep,
} from "@wasm/ProducerCompileGuard.ts";
import { exportJSONUnchecked } from "@creature/CreatureSerialization.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

class OffspringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffspringError";
  }
}

/**
 * Issue #2648: Shallow-clone a parent and run `prepareCreatureForBreeding`
 * inside a guard. Returns the prepared parent on success, or `undefined`
 * when the parent's topology is too broken to validate (typed
 * `TopologyError` / `ValidationError`). Unexpected errors propagate.
 *
 * The previous flow let WASM `RuntimeError: memory access out of bounds`
 * traps from `TypedTopology.validateForwardOnly()` escape uncaught and
 * terminate the whole `evolveRL()` run. With the WASM-trap guard in
 * `WasmTopologyOps.withWasmTrapGuard`, those traps now arrive here as a
 * `TopologyError` and we can drop the offspring exactly the way the
 * producer-side compile guards already do.
 */
function safelyPrepareParent(
  parent: Creature,
  role: "mother" | "father",
): Creature | undefined {
  try {
    return prepareCreatureForBreeding(parent.shallowClone());
  } catch (err) {
    if (err instanceof TopologyError || err instanceof ValidationError) {
      const reason = (err as { reason?: string }).reason ?? "unknown";
      getLogger().warn(
        `[Offspring] dropping offspring with corrupt ${role} ` +
          `(uuid=${parent.uuid ?? "<unknown>"}, ` +
          `neurons=${parent.neurons.length}, ` +
          `synapses=${parent.synapses.length}): ` +
          `${err.name} reason=${reason} - ${err.message}`,
      );
      return undefined;
    }
    throw err;
  }
}

/**
 * Issue #1644: Deferred connection reference. Stores a reference to the parent
 * creature and its internal synapse array instead of cloning to SynapseExport
 * objects. UUIDs are resolved on-the-fly via parent.neurons[synapse.from].id,
 * eliminating thousands of intermediate object allocations.
 */
export interface ConnectionRef {
  parent: Creature;
  synapses: SynapseInternal[];
}

/**
 * Compute the dependency-aware sort index for a neuron based on its inward
 * synapses. Returns the adjusted index (≥ 0) when all non-input dependencies
 * are resolved in `childMap`, or -1 when at least one dependency is still
 * unresolved.
 */
export function computeNeuronDependencyIndex(
  baseIndex: number,
  ref: ConnectionRef | undefined,
  childMap: Map<number, number>,
): number {
  if (!ref) return baseIndex;

  let indx = baseIndex;
  const parentNeurons = ref.parent.neurons;
  for (const synapse of ref.synapses) {
    if (indx < 0) break;

    const fromNeuron = parentNeurons[synapse.from];
    if (fromNeuron.type === "input") continue;

    const dependantIndx = childMap.get(fromNeuron.id);
    if (dependantIndx === undefined) {
      indx = -1;
    } else if (dependantIndx >= indx) {
      indx = dependantIndx + 1;
    }
  }
  return indx;
}

export class Offspring {
  /**
   * Create an offspring from two parent networks.
   *
   * Forward-only: parent edges that become backward after {@link sortNeurons}
   * are omitted from the batch, then {@link repairForwardOnlyComputationalInbounds}
   * restores wire-aligned inbounds from parents where possible. The child is
   * rejected with diagnostics if it still fails `creatureValidate`.
   */
  static breed(
    mum: Creature,
    dad: Creature,
    options: {
      geneticCompatibilityThreshold?: number;
      interSpeciesCrossoverThreshold?: number;
      forwardOnly?: boolean;
      hyperparameterEvolution?: RequiredHyperparameterEvolutionConfig;
      /** Issue #2284: Optional accumulator for sub-phase timing instrumentation. */
      subPhaseAccumulator?: BreedingSubPhaseAccumulator;
    } = {},
  ): Creature | undefined {
    const acc = options.subPhaseAccumulator;
    const rng = getRandomNumberGenerator();
    // Issue #1095: Use shallowClone() instead of JSON serialisation/deserialisation
    // for parent preparation. shallowClone() is 3-4x faster as it:
    // - Creates new Creature with copied neuron/synapse arrays
    // - Avoids JSON string creation and parsing overhead
    //
    // Issue #2648: If `prepareCreatureForBreeding` throws because the parent
    // is too broken to validate (e.g. a WASM topology trap wrapped as a
    // typed error by `WasmTopologyOps.withWasmTrapGuard`), drop the offspring
    // instead of letting the error abort the whole evolution run. Other
    // unexpected errors still propagate.
    const mother = safelyPrepareParent(mum, "mother");
    if (!mother) return undefined;
    CreatureUtil.makeUUID(mother);
    let father = safelyPrepareParent(dad, "father");
    if (!father) return undefined;
    CreatureUtil.makeUUID(father);
    assert(
      mother.input === father.input && mother.output === father.output,
      "Parents aren't the same species",
    );

    // Issue #2284: Time genetic compatibility sub-phase
    const compatStartMs = acc ? Date.now() : 0;
    const compatibility = geneticCompatibility(mother, father);
    if (acc) acc.geneticCompatibilityMs += Date.now() - compatStartMs;

    // Issue #2175/#2177: When compatibility is very low (below
    // interSpeciesCrossoverThreshold), use specialised inter-species breeding.
    // Randomly selects between input-weight crossover (Issue #2175) and subgraph
    // transplantation (Issue #2177), falling back to the other if the first fails.
    const interSpeciesThreshold = options.interSpeciesCrossoverThreshold ?? 0;
    if (
      interSpeciesThreshold > 0 &&
      compatibility < interSpeciesThreshold &&
      options.geneticCompatibilityThreshold &&
      compatibility < options.geneticCompatibilityThreshold
    ) {
      let child: Creature | undefined;
      if (rng.random() < 0.5) {
        // Try subgraph transplantation first, fall back to input-weight crossover
        child = subgraphTransplant(mother, father);
        if (!child) child = inputWeightCrossover(mother, father);
      } else {
        // Try input-weight crossover first, fall back to subgraph transplantation
        child = inputWeightCrossover(mother, father);
        if (!child) child = subgraphTransplant(mother, father);
      }
      if (child) {
        // Memetic update (same as standard crossover path)
        if (mother.memetic) {
          child.memetic = memeticUpdate(mother, child);
        } else if (father.memetic) {
          child.memetic = memeticUpdate(father, child);
        }

        // Hyperparameter crossover (same as standard crossover path)
        const hpConfig = options.hyperparameterEvolution ??
          DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG;
        if (hpConfig.enabled) {
          child.hyperparameters = crossoverHyperparameters(
            mum.hyperparameters,
            dad.hyperparameters,
            hpConfig,
          );
        } else if (mum.hyperparameters || dad.hyperparameters) {
          child.hyperparameters = mum.hyperparameters
            ? { ...mum.hyperparameters }
            : dad.hyperparameters
            ? { ...dad.hyperparameters }
            : undefined;
        }

        if (child.memetic) {
          pruneOrphanMemeticReferences(child);
        }

        return child;
      }
      // Fall through to standard crossover if input-weight crossover fails
    }

    let fixAliases = false;
    if (
      options.geneticCompatibilityThreshold &&
      compatibility < options.geneticCompatibilityThreshold
    ) {
      father = editParentByIndex(mother, father);
      CreatureUtil.makeUUID(father);

      fixAliases = true;
    }

    // Issue #2284: Time alignment/crossover sub-phase (neuron maps → clone nodes)
    const alignStartMs = acc ? Date.now() : 0;

    // Pre-build Maps for O(1) neuron lookup by integer ID.
    // This replaces O(n) linear .find() searches, improving breeding performance
    // from O(n²) to O(n) for creatures with many neurons. (Issue #1024, #1958)
    const motherNeuronMap = new Map<number, Neuron>();
    for (const neuron of mother.neurons) {
      motherNeuronMap.set(neuron.id, neuron);
    }
    const fatherNeuronMap = new Map<number, Neuron>();
    for (const neuron of father.neurons) {
      fatherNeuronMap.set(neuron.id, neuron);
    }

    const shouldBeForwardOnly = options.forwardOnly === true ||
      (options.forwardOnly === undefined &&
        (mother.forwardOnly === true || father.forwardOnly === true));

    // Initialise offspring in explicit topology mode; semantic version is always
    // current for newly bred genomes (legacy upgrade applies to parents only).
    const offspring = new Creature(mother.input, mother.output, {
      lazyInitialization: true,
      feedbackEnabled: !shouldBeForwardOnly,
    });
    offspring.synapses = [];
    offspring.neurons = [];

    const neuronMap = new Map<number, Neuron>();
    // Issue #1644: Use deferred connection references instead of cloning to
    // SynapseExport objects. This eliminates thousands of intermediate object
    // allocations by storing references to the parent creature's internal data.
    const connectionsMap = new Map<number, ConnectionRef>();

    // Populate neuronMap and connectionsMap with neurons and synapses from both parents
    for (const node of mother.neurons) {
      if (node.type !== "input") {
        const connections = mother.inwardConnections(node.index);
        Offspring.fixType(node, connections);
        neuronMap.set(node.id, node);
        connectionsMap.set(node.id, {
          parent: mother,
          synapses: connections,
        });
      }
    }

    for (const node of father.neurons) {
      if (node.type !== "input") {
        if (rng.random() >= 0.5) {
          const connections = father.inwardConnections(node.index);
          // Issue #2497: A father hidden neuron with no inward connections would
          // be converted to `constant` by fixType. Taking it overrides the
          // mother's connectionsMap entry (which may have had inward connections),
          // severing those connections and leaving genuine constant neurons with
          // no outward connections. Prefer the mother's version whenever the
          // father's hidden neuron would be demoted to constant but the mother's
          // version has proper inward connections.
          if (node.type === "hidden" && connections.length === 0) {
            const motherRef = connectionsMap.get(node.id);
            if (motherRef && motherRef.synapses.length > 0) continue;
          }
          Offspring.fixType(node, connections);
          neuronMap.set(node.id, node);
          connectionsMap.set(
            node.id,
            { parent: father, synapses: connections },
          );
        }
      }
    }

    // Ensure all neurons are in neuronMap
    let addedMissing;
    do {
      addedMissing = false;
      for (const neuronId of neuronMap.keys()) {
        const ref = connectionsMap.get(neuronId);
        if (ref) {
          const parentNeurons = ref.parent.neurons;
          for (const synapse of ref.synapses) {
            const fromId = parentNeurons[synapse.from].id;
            let fromNeuron = neuronMap.get(fromId);
            if (!fromNeuron) {
              // Use pre-built Maps for O(1) lookup instead of O(n) .find()
              const motherNeuron = motherNeuronMap.get(fromId);
              fromNeuron = motherNeuron;
              let parent = mother;
              if (!fromNeuron || rng.random() >= 0.5) {
                const fatherNeuron = fatherNeuronMap.get(fromId);
                if (fatherNeuron) {
                  fromNeuron = fatherNeuron;
                  parent = father;
                }
              }
              if (!fromNeuron) {
                throw new TopologyError(
                  `Can't find ${fromId}`,
                  "MISSING_NEURON",
                );
              }

              neuronMap.set(fromNeuron.id, fromNeuron);
              const parentConnections = parent.inwardConnections(
                fromNeuron.index,
              );
              connectionsMap.set(
                fromNeuron.id,
                { parent, synapses: parentConnections },
              );
              addedMissing = true;
            }
          }
        } else {
          throw new TopologyError(
            `Can't find connections for ${neuronId}`,
            "MISSING_NEURON",
          );
        }
      }
    } while (addedMissing);

    // Function to clone nodes and create the offspring network
    const tmpNodes: Neuron[] = [];
    const tmpIds = new Set<number>();

    function cloneNode(neuron: Neuron) {
      if (!tmpIds.has(neuron.id)) {
        const ref = connectionsMap.get(neuron.id);
        if (!ref) {
          throw new TopologyError(
            `Can't find connections for ${neuron.id}`,
            "MISSING_NEURON",
          );
        }
        tmpIds.add(neuron.id);
        const parentNeurons = ref.parent.neurons;
        for (const synapse of ref.synapses) {
          const fromId = parentNeurons[synapse.from].id;
          const fromNeuron = neuronMap.get(fromId);
          if (!fromNeuron) {
            throw new TopologyError(
              `Can't find ${fromId}`,
              "MISSING_NEURON",
            );
          } else if (fromNeuron.type !== "input") {
            cloneNode(fromNeuron);
          }
        }
        tmpNodes.push(neuron);
      }
    }

    // Add input neurons
    for (let indx = 0; indx < mother.input; indx++) {
      const input = mother.neurons[indx];
      tmpNodes.push(input);
      tmpIds.add(input.id);
    }

    // Add output neurons
    for (let indx = mother.output; indx--;) {
      const node = neuronMap.get(outputNeuronId(indx));
      if (node !== undefined) {
        cloneNode(node);
      } else {
        throw new TopologyError(
          `Can't find output neuron ${indx}`,
          "MISSING_NEURON",
        );
      }
    }

    // Issue #2284: End alignment/crossover, start sortNeurons sub-phase
    if (acc) acc.alignmentCrossoverMs += Date.now() - alignStartMs;
    const sortStartMs = acc ? Date.now() : 0;

    try {
      Offspring.sortNeurons(
        tmpNodes,
        mother.neurons,
        father.neurons,
        connectionsMap,
      );
    } catch (e) {
      if (e instanceof OffspringError) {
        return undefined;
      }
      throw e;
    }

    // Issue #2284: End sortNeurons sub-phase
    if (acc) acc.sortNeuronsMs += Date.now() - sortStartMs;

    const tmpNodesLen = tmpNodes.length;
    offspring.neurons.length = tmpNodesLen;
    const indxMap = new Map<number, number>();
    for (let indx = 0; indx < tmpNodesLen; indx++) {
      const neuron = tmpNodes[indx];
      const newNode = new Neuron(
        neuron.id,
        neuron.type,
        neuron.bias,
        offspring,
        neuron.squash,
        neuron.uuid,
      );

      addTags(newNode, neuron);

      newNode.index = indx;
      offspring.neurons[indx] = newNode;
      indxMap.set(neuron.id, indx);
    }

    // Issue #2284: Time batch connection sub-phase
    const batchStartMs = acc ? Date.now() : 0;

    // Issue #1102: Collect all connections first, then batch connect
    // This reduces cache invalidation overhead from O(n) to O(1)
    const batchConnections: Array<{
      from: number;
      to: number;
      weight: number;
      type?: "positive" | "negative" | "condition";
      tags?: SynapseInternal["tags"];
    }> = [];

    // Issue #1644: Use numeric keys to avoid string allocation for deduplication.
    // Encode (from, to) as a single number: from * neuronCount + to.
    const neuronCount = offspring.neurons.length;
    const connectionSet = new Set<number>();

    for (const neuron of offspring.neurons) {
      if (neuron.type !== "input") {
        const ref = connectionsMap.get(neuron.id);
        if (!ref) {
          throw new TopologyError(
            `Can't find connections for ${neuron.id}`,
            "MISSING_NEURON",
          );
        }
        const parentNeurons = ref.parent.neurons;
        for (const synapse of ref.synapses) {
          const fromId = parentNeurons[synapse.from].id;
          const toId = parentNeurons[synapse.to].id;
          const fromIndx = indxMap.get(fromId);
          const toIndx = indxMap.get(toId);

          if (fromIndx !== undefined && toIndx !== undefined) {
            // After sortNeurons, a parent edge that was forward in the parent can
            // map to fromIndx > toIndx in the child. Skip it for forward-only
            // offspring; repairForwardOnlyComputationalInbounds restores a valid
            // forward inbound from the same parent neuron when possible.
            if (shouldBeForwardOnly && fromIndx >= toIndx) {
              continue;
            }

            const toType = offspring.neurons[toIndx].type;
            if (toType === "hidden" || toType === "output") {
              const key = fromIndx * neuronCount + toIndx;
              if (!connectionSet.has(key)) {
                connectionSet.add(key);
                batchConnections.push({
                  from: fromIndx,
                  to: toIndx,
                  weight: synapse.weight,
                  type: synapse.type,
                  tags: synapse.tags,
                });
              }
            } else {
              throw new TopologyError(
                `Can't connect to ${toType} neuron at indx=${toIndx} of type ${toType}!`,
                "INVALID_CONNECTION",
              );
            }
          }
        }
      }
    }

    // Batch connect all synapses with single cache invalidation
    offspring.connectBatch(batchConnections);

    // Issue #2191: Verify forward-only topology after breeding index remap
    assertForwardOnlyTopologyAfterBulkRemap(offspring, "Offspring.breed");

    // Apply tags to the created synapses
    for (const conn of batchConnections) {
      if (conn.tags) {
        const synapse = offspring.getSynapse(conn.from, conn.to);
        if (synapse) {
          addTags(synapse, { tags: conn.tags });
        }
      }
    }

    // Issue #2284: End batch connection, start post-breeding repair sub-phase
    if (acc) acc.batchConnectionMs += Date.now() - batchStartMs;
    const repairStartMs = acc ? Date.now() : 0;

    // Issue #1097: Prebuild inward index for large offspring.
    // This optimises subsequent inward connection lookups and memetic updates
    // by avoiding linear scans.
    offspring.prebuildInwardIndexIfLarge();

    // Issue #2086 / GRQ logs: `exportJSON()` is UUID-only (#2054). If two hidden
    // neurons still share a `uuid`, `loadFrom()` maps that uuid to a single index
    // and silently mis-wires synapses. Graft (`fixAliases`) round-trips through
    // export+load — dedupe UUIDs *before* that path (regression vs integer-id alias
    // rewrite, ~Mar 2026).
    Offspring.ensureUniqueNeuronUuids(offspring);

    if (fixAliases) {
      const fixed = offspring.exportJSON();
      restoreGraftAliases(fixed);
      offspring.loadFrom(fixed, false, "breed:fixAliases");
    }

    offspring.clearState();

    delete offspring.uuid;
    const childUUID = CreatureUtil.makeUUID(offspring);

    // Issue #2672: Capture the post-splice/pre-fix offspring snapshot so the
    // producer-gate diagnostic dump can include both the raw cross-over
    // output and the post-fix output. Use the unchecked exporter — the
    // creature has not been repaired yet and may not pass `creatureValidate`.
    let preFixOffspringExport: CreatureExport | string;
    try {
      preFixOffspringExport = exportJSONUnchecked(offspring);
    } catch {
      preFixOffspringExport =
        "(pre-fix export failed — offspring too corrupted to serialise)";
    }

    assert(childUUID, "Failed to make UUID for offspring");
    assert(mother.uuid, "Failed to make UUID for mother");
    assert(father.uuid, "Failed to make UUID for father");
    /* No point returning clones */
    if (childUUID === mother.uuid || childUUID === father.uuid) {
      return undefined;
    }

    if (mother.memetic) {
      const memetic = memeticUpdate(mother, offspring);
      offspring.memetic = memetic;
    } else if (father.memetic) {
      const memetic = memeticUpdate(father, offspring);
      offspring.memetic = memetic;
    }

    // Issue #1863: Crossover per-creature hyperparameters
    const hpConfig = options.hyperparameterEvolution ??
      DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG;
    if (hpConfig.enabled) {
      offspring.hyperparameters = crossoverHyperparameters(
        mum.hyperparameters,
        dad.hyperparameters,
        hpConfig,
      );
    } else if (mum.hyperparameters || dad.hyperparameters) {
      // Preserve hyperparameters even when evolution is disabled,
      // inheriting from the fitter parent (mother).
      offspring.hyperparameters = mum.hyperparameters
        ? { ...mum.hyperparameters }
        : dad.hyperparameters
        ? { ...dad.hyperparameters }
        : undefined;
    }

    if (shouldBeForwardOnly) {
      // Issue #2685: Attribute any producer-gate rejection that arises from
      // these repair steps to the specific sub-step that emitted the bad
      // topology, rather than reporting the generic `Offspring/breed`
      // producer name only.
      setProducerStep("Offspring.repairForwardOnlyComputationalInbounds");
      try {
        Offspring.repairForwardOnlyComputationalInbounds(
          offspring,
          mother,
          father,
        );
      } finally {
        setProducerStep(undefined);
      }
      setProducerStep("Offspring.repairOrphanedConstants");
      try {
        Offspring.repairOrphanedConstants(offspring, mother, father);
      } finally {
        setProducerStep(undefined);
      }
    }

    if (offspring.memetic) {
      pruneOrphanMemeticReferences(offspring);
    }

    if (shouldBeForwardOnly) {
      if (options.forwardOnly === false) {
        getLogger().warn(
          `[Offspring] feedbackLoop/memory mode requested but parents are forward-only; forcing forwardOnly child`,
        );
      }
      offspring.forwardOnly = true;
      for (let i = 0; i < offspring.synapses.length; i++) {
        const s = offspring.synapses[i];
        if (s.from >= s.to) {
          const violations = offspring.synapses
            .map((syn, j) => ({ syn, j }))
            .filter(({ syn }) => syn.from === syn.to || syn.from > syn.to)
            .slice(0, 10)
            .map(({ syn, j }) =>
              `${j}) ${syn.from} (${
                offspring.neurons[syn.from]?.ID?.() ?? "?"
              }) -> ${syn.to} (${offspring.neurons[syn.to]?.ID?.() ?? "?"})`
            );

          offspring.DEBUG = false;
          writeDiagnostics({
            error: new TopologyError(
              `Forward-only offspring has recurrent synapse at index ${i}`,
              "INVALID_CONNECTION",
            ),
            prefix: "offspring-forward-only-violation",
            mother: mother.exportJSON(),
            father: father.exportJSON(),
            offspring: offspring.exportJSON(),
          });
          throw new TopologyError(
            `[Offspring] CRITICAL: forward-only offspring has recurrent connections after breed — ` +
              `Mother: ${mother.uuid} (${mother.semanticVersion}), ` +
              `Father: ${father.uuid} (${father.semanticVersion}). ` +
              `Violations: ${violations.join(" | ")}`,
            "INVALID_CONNECTION",
          );
        }
      }

      try {
        creatureValidate(offspring, { forwardOnly: true });
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        offspring.DEBUG = false;
        writeDiagnostics({
          error: e instanceof Error ? e : new Error(msg),
          prefix: "offspring-breed-validation",
          mother: mother.exportJSON(),
          father: father.exportJSON(),
          offspring: offspring.exportJSON(),
        });
        throw new TopologyError(
          `[Offspring] Forward-only offspring failed creatureValidate after breed: ${msg}`,
          "INVALID_CONNECTION",
        );
      }
    }

    // Issue #2636: WASM compile sanity gate. Some mutation/breeding paths emit
    // topologies that pass `creatureValidate({ forwardOnly: true })` yet still
    // trap inside `CompiledNetwork::new` with `RuntimeError: unreachable` (the
    // GRQ-3 scorer logged two such offspring with shape neurons=2156,
    // inputs=2054, outputs=3). Run a one-shot compile probe here so a bad
    // topology is repaired or dropped at the producer rather than leaking into
    // training and only being caught by the call-site recovery (#2483).
    // Issue #2685: Default the step to `Offspring.breed:splice-repair` so
    // an offspring that survives the earlier sub-steps but still fails the
    // compile gate is attributed to the breed phase as a whole. Sub-step
    // labels set above are cleared once those steps finish; on rejection
    // here we capture the gate's own label.
    setProducerStep("Offspring.breed:splice-repair");
    let compileResult: ReturnType<typeof runProducerCompileProbe>;
    try {
      compileResult = runProducerCompileProbe(offspring);
    } finally {
      setProducerStep(undefined);
    }
    if (!compileResult.ok) {
      offspring.DEBUG = false;
      const producerStep = compileResult.producerStep ??
        "Offspring.breed:splice-repair";
      // Issue #2672: Capture post-fix offspring even when `exportJSON()`
      // could throw (the compile gate has already declared this topology
      // bad). The diagnostic dump must always land.
      let postFixOffspringExport: CreatureExport | string;
      try {
        postFixOffspringExport = exportJSONUnchecked(offspring);
      } catch {
        postFixOffspringExport =
          "(post-fix export failed — offspring too corrupted to serialise)";
      }
      const trapMessage = compileResult.trapMessage ?? "unknown trap";
      const activeSeed = rng.seed;
      writeDiagnostics({
        error: new TopologyError(
          `WASM compile failed for offspring: ${trapMessage}`,
          "INVALID_CONNECTION",
        ),
        // Issue #2672: standardised dump prefix so post-mortem tooling can
        // grep `.diagnostics/` for `offspring-wasm-compile-trap-*` files.
        prefix: `offspring-wasm-compile-trap-${childUUID}`,
        mother: mother.exportJSON(),
        father: father.exportJSON(),
        offspring: typeof postFixOffspringExport === "string"
          ? undefined
          : postFixOffspringExport,
        context: {
          // Replay metadata for offline reproduction (Issue #2672).
          motherUuid: mother.uuid ?? "n/a",
          fatherUuid: father.uuid ?? "n/a",
          offspringUuid: childUUID,
          breedSeed: activeSeed ?? "n/a (unseeded RNG)",
          prngSeeded: rng.seeded,
          // Issue #2685: surface the originating producer step.
          producerStep,
          trapMessage,
          preFixOffspring: preFixOffspringExport,
          postFixOffspringSerialisationError:
            typeof postFixOffspringExport === "string"
              ? postFixOffspringExport
              : undefined,
          neuronCount: offspring.neurons.length,
          synapseCount: offspring.synapses.length,
          inputCount: offspring.input,
          outputCount: offspring.output,
          forwardOnly: offspring.forwardOnly,
        },
      });
      getLogger().warn(
        `[Offspring/breed] dropping offspring from step=${producerStep} that fails WASM compile (` +
          `neurons=${offspring.neurons.length}, inputs=${offspring.input}, ` +
          `outputs=${offspring.output}): ${
            compileResult.trapMessage ?? "unknown trap"
          }`,
      );
      if (acc) acc.postBreedingRepairMs += Date.now() - repairStartMs;
      return undefined;
    }

    // Issue #2284: End post-breeding repair sub-phase, record successful offspring
    if (acc) {
      acc.postBreedingRepairMs += Date.now() - repairStartMs;
      acc.offspringCount++;
    }

    return offspring;
  }

  /**
   * Build a `wire label -> neuron index` map for a parent so the forward-only
   * repair routines can resolve a label in O(1) instead of rescanning the whole
   * neuron array per offspring neuron (Issue #3090). First-match wins, mirroring
   * the linear scan this replaces.
   */
  private static buildParentWireLabelIndex(
    parent: Creature,
  ): Map<string, number> {
    const labelToIndex = new Map<string, number>();
    for (let i = 0; i < parent.neurons.length; i++) {
      const label = neuronWireLabelForDiagnostics(parent.neurons[i], i);
      if (!labelToIndex.has(label)) {
        labelToIndex.set(label, i);
      }
    }
    return labelToIndex;
  }

  /**
   * After skipping parent edges that would be backward in the child ordering,
   * restore at least one forward inbound for each hidden/output by reusing a
   * mappable parent synapse (wire-label aligned), or a last-resort edge from
   * the first input.
   */
  private static repairForwardOnlyComputationalInbounds(
    offspring: Creature,
    mother: Creature,
    father: Creature,
  ): void {
    const labelToOffspringIndex = new Map<string, number>();
    for (let i = 0; i < offspring.neurons.length; i++) {
      labelToOffspringIndex.set(
        neuronWireLabelForDiagnostics(offspring.neurons[i], i),
        i,
      );
    }

    // Issue #3090: precompute each parent's wire-label -> index map once so the
    // per-neuron parent lookups below are O(1) rather than a full array rescan.
    const parents = [mother, father];
    const parentLabelToIndex = parents.map((parent) =>
      Offspring.buildParentWireLabelIndex(parent)
    );

    for (let i = offspring.input; i < offspring.neurons.length; i++) {
      const node = offspring.neurons[i];
      if (node.type !== "hidden" && node.type !== "output") continue;
      if (offspring.inwardConnections(i).length > 0) continue;

      const label = neuronWireLabelForDiagnostics(node, i);

      let linked = false;
      for (let p = 0; p < parents.length; p++) {
        const parent = parents[p];
        const pIdx = parentLabelToIndex[p].get(label);
        if (pIdx === undefined) continue;

        for (const syn of parent.inwardConnections(pIdx)) {
          const fromLabel = neuronWireLabelForDiagnostics(
            parent.neurons[syn.from],
            syn.from,
          );
          const fromI = labelToOffspringIndex.get(fromLabel);
          if (
            fromI !== undefined && fromI < i &&
            offspring.getSynapse(fromI, i) === null
          ) {
            offspring.connect(fromI, i, syn.weight, syn.type);
            linked = true;
            break;
          }
        }
        if (linked) break;
      }

      if (!linked && i > 0 && offspring.getSynapse(0, i) === null) {
        offspring.connect(0, i, SynapseClass.randomWeight());
      }
    }

    offspring.clearCache();
  }

  /**
   * Repairs constant neurons that have no outward connections after forward-only
   * breeding. This mirrors {@link repairForwardOnlyComputationalInbounds} but
   * addresses the symmetric failure: a constant neuron (no inward connections)
   * whose outward connections were all dropped because they mapped to backward
   * positions in the re-sorted offspring.
   *
   * For each orphaned constant:
   * 1. Look up outward connections from the matched parent neuron (wire-label).
   * 2. Add the first valid forward connection found.
   * 3. Fall back to the first hidden/output neuron after this one.
   */
  private static repairOrphanedConstants(
    offspring: Creature,
    mother: Creature,
    father: Creature,
  ): void {
    const labelToOffspringIndex = new Map<string, number>();
    for (let i = 0; i < offspring.neurons.length; i++) {
      labelToOffspringIndex.set(
        neuronWireLabelForDiagnostics(offspring.neurons[i], i),
        i,
      );
    }

    // Issue #3090: precompute each parent's wire-label -> index map once so the
    // per-neuron parent lookups below are O(1) rather than a full array rescan.
    const parents = [mother, father];
    const parentLabelToIndex = parents.map((parent) =>
      Offspring.buildParentWireLabelIndex(parent)
    );

    for (let i = offspring.input; i < offspring.neurons.length; i++) {
      const node = offspring.neurons[i];
      if (node.type !== "constant") continue;
      if (offspring.outwardConnections(i).length > 0) continue;

      const label = neuronWireLabelForDiagnostics(node, i);

      let linked = false;
      for (let p = 0; p < parents.length; p++) {
        const parent = parents[p];
        const pIdx = parentLabelToIndex[p].get(label);
        if (pIdx === undefined) continue;

        for (const syn of parent.outwardConnections(pIdx)) {
          const toLabel = neuronWireLabelForDiagnostics(
            parent.neurons[syn.to],
            syn.to,
          );
          const toI = labelToOffspringIndex.get(toLabel);
          if (
            toI !== undefined && toI > i &&
            offspring.getSynapse(i, toI) === null
          ) {
            offspring.connect(i, toI, syn.weight, syn.type);
            linked = true;
            break;
          }
        }
        if (linked) break;
      }

      // Fall back: connect to the first hidden/output neuron after this constant.
      if (!linked) {
        for (let j = i + 1; j < offspring.neurons.length; j++) {
          const target = offspring.neurons[j];
          if (
            (target.type === "hidden" || target.type === "output") &&
            offspring.getSynapse(i, j) === null
          ) {
            offspring.connect(i, j, SynapseClass.randomWeight());
            break;
          }
        }
      }
    }

    offspring.clearCache();
  }

  private static fixType(node: Neuron, connections: SynapseInternal[]) {
    if (node.type === "constant") {
      if (connections.length > 0) {
        node.type = "hidden";
      }
    } else if (node.type === "hidden") {
      if (connections.length === 0) {
        node.type = "constant";
      }
    }
  }

  private static ensureUniqueNeuronUuids(creature: Creature): void {
    const seen = new Set<string>();
    for (const neuron of creature.neurons) {
      if (neuron.type !== "hidden" && neuron.type !== "constant") continue;
      const uuid = neuron.uuid;
      if (!uuid) continue;
      if (!seen.has(uuid)) {
        seen.add(uuid);
        continue;
      }
      neuron.uuid = crypto.randomUUID();
    }
  }

  public static cloneConnections(
    creature: Creature,
    connections: SynapseInternal[],
  ): SynapseExport[] {
    const neurons = creature.neurons;
    const len = connections.length;
    const tmpConnections: SynapseExport[] = new Array(len);

    for (let i = 0; i < len; i++) {
      const connection = connections[i];
      tmpConnections[i] = {
        fromId: neurons[connection.from].id,
        toId: neurons[connection.to].id,
        weight: connection.weight,
        type: connection.type,
        tags: connection.tags,
      };
    }

    return tmpConnections;
  }

  public static sortNeurons(
    child: Neuron[],
    mother: Neuron[],
    father: Neuron[],
    connectionsMap: Map<number, ConnectionRef>,
  ) {
    const childMap = new Map<number, number>();

    // Issue #1644: Build mumMap and seed childMap with inputs in a single pass
    const mumMap = new Map<number, number>();
    for (let indx = 0; indx < mother.length; indx++) {
      const neuron = mother[indx];
      mumMap.set(neuron.id, indx);
      if (neuron.type === "input") childMap.set(neuron.id, indx);
    }

    const dadMap = new Map<number, number>();
    for (let indx = 0; indx < father.length; indx++) {
      dadMap.set(father[indx].id, indx);
    }

    let firstMap = mumMap;
    let secondMap = dadMap;
    if (mumMap.size < dadMap.size) {
      firstMap = dadMap;
      secondMap = mumMap;
    }

    /* Sort output to the end and input to the beginning */
    child.sort((a: Neuron, b: Neuron) => {
      if (a.type === "output") {
        if (b.type !== "output") {
          return 1;
        }
        return outputIndexFromId(a.id) - outputIndexFromId(b.id);
      } else if (b.type === "output") {
        return -1;
      }

      if (a.id === b.id) {
        throw new TopologyError(
          `Duplicate neuron id ${a.id}`,
          "DUPLICATE_UUID",
        );
      }
      let indxA = firstMap.get(a.id);
      if (indxA === undefined) {
        indxA = secondMap.get(a.id);
        if (indxA === undefined) {
          throw new TopologyError(`Can't find ${a.id}`, "MISSING_NEURON");
        }
        indxA += 0.1;
      }

      let indxB = firstMap.get(b.id);
      if (indxB === undefined) {
        indxB = secondMap.get(b.id);
        if (indxB === undefined) {
          throw new TopologyError(`Can't find ${b.id}`, "MISSING_NEURON");
        }
        indxB += 0.1;
      }

      if (indxA === indxB) {
        throw new TopologyError(`Duplicate index ${indxA}`, "DUPLICATE_UUID");
      }

      if (a.type === "constant" && b.type === "hidden") return -1;
      if (a.type === "hidden" && b.type === "constant") return 1;

      return indxA - indxB;
    });

    /*
     * Issue #2285: Kahn's algorithm topological sort — O(V+E) replacement
     * for the previous O(n²) iterative dependency resolution loop.
     *
     * Steps:
     *   1. Collect non-input, non-output neuron IDs and their parent base indices.
     *   2. Build a dependency graph (adjacency list + in-degree counts).
     *   3. Process zero-in-degree neurons in parent-index order (Kahn's BFS).
     *   4. Assign monotonically increasing sort indices into childMap.
     */
    const nonIOIds = new Set<number>();
    const parentBaseIndex = new Map<number, number>();

    for (const neuron of child) {
      if (neuron.type !== "input" && neuron.type !== "output") {
        const nId = neuron.id;
        nonIOIds.add(nId);

        const firstIndx = firstMap.get(nId);
        if (firstIndx !== undefined) {
          parentBaseIndex.set(nId, firstIndx);
        } else {
          const secondIndx = secondMap.get(nId);
          if (secondIndx !== undefined) {
            parentBaseIndex.set(nId, secondIndx);
          } else {
            throw new TopologyError(
              `Can't find ${nId} in father or mother creatures!`,
              "MISSING_NEURON",
            );
          }
        }
      }
    }

    // Build adjacency list (dependency → dependents) and in-degree counts.
    // Use Sets for unique dependencies to avoid over-counting duplicate synapses.
    const inDegree = new Map<number, number>();
    const dependents = new Map<number, number[]>();
    for (const nId of nonIOIds) {
      inDegree.set(nId, 0);
      dependents.set(nId, []);
    }

    for (const nId of nonIOIds) {
      const ref = connectionsMap.get(nId);
      if (!ref) continue;

      const parentNeurons = ref.parent.neurons;
      const seen = new Set<number>(); // deduplicate multi-synapse sources
      for (const synapse of ref.synapses) {
        const fromNeuron = parentNeurons[synapse.from];
        if (fromNeuron.type === "input") continue;

        const fromId = fromNeuron.id;
        if (nonIOIds.has(fromId) && !seen.has(fromId)) {
          seen.add(fromId);
          inDegree.set(nId, (inDegree.get(nId) ?? 0) + 1);
          dependents.get(fromId)!.push(nId);
        }
      }
    }

    // Seed the BFS queue with zero-in-degree neurons, sorted by parent index.
    const queue: number[] = [];
    for (const [nId, deg] of inDegree) {
      if (deg === 0) queue.push(nId);
    }
    queue.sort(
      (a, b) => (parentBaseIndex.get(a) ?? 0) - (parentBaseIndex.get(b) ?? 0),
    );

    // Start sort indices after all pre-seeded input indices to avoid
    // conflicts in the final comparator (input vs hidden/constant).
    let sortIndex = 0;
    for (const idx of childMap.values()) {
      if (idx >= sortIndex) sortIndex = idx + 1;
    }
    let processed = 0;

    while (queue.length > 0) {
      const nId = queue.shift()!;
      childMap.set(nId, sortIndex++);
      processed++;

      const deps = dependents.get(nId)!;
      if (deps.length > 0) {
        const newlyReady: number[] = [];
        for (const depId of deps) {
          const newDeg = (inDegree.get(depId) ?? 1) - 1;
          inDegree.set(depId, newDeg);
          if (newDeg === 0) {
            newlyReady.push(depId);
          }
        }
        if (newlyReady.length > 0) {
          // Insert into queue maintaining parent-index order.
          for (const r of newlyReady) queue.push(r);
          queue.sort(
            (a, b) =>
              (parentBaseIndex.get(a) ?? 0) - (parentBaseIndex.get(b) ?? 0),
          );
        }
      }
    }

    if (processed !== nonIOIds.size) {
      throw new OffspringError("Can't find a solution to sort the nodes!");
    }

    /** Second sort should only change the order of new nodes. */
    child.sort((a: Neuron, b: Neuron) => {
      if (a.type === "output") {
        if (b.type !== "output") {
          return 1;
        }
        return outputIndexFromId(a.id) - outputIndexFromId(b.id);
      } else if (b.type === "output") {
        return -1;
      } else if (a.type === "input" && b.type === "input") {
        return a.index - b.index;
      } else {
        const aIndx = childMap.get(a.id);
        if (aIndx === undefined) {
          throw new TopologyError(`Can't find ${a.id}`, "MISSING_NEURON");
        }
        const bIndx = childMap.get(b.id);
        if (bIndx === undefined) {
          throw new TopologyError(`Can't find ${b.id}`, "MISSING_NEURON");
        }

        /*
         * Sort by index in child array, if not input or output.
         * This will ensure that the order of the nodes is the same as the order of the nodes in the mother and father networks.
         * This is important for the crossover function to work correctly.
         */
        if (a.type === "constant" && b.type === "hidden") {
          return -1;
        }
        if (a.type === "hidden" && b.type === "constant") {
          return 1;
        }
        return aIndx - bIndx;
      }
    });
  }
}
