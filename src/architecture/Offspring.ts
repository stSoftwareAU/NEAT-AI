import { assert } from "@std/assert";
import { addTags, getTag, removeTag } from "@stsoftware/tags/mod";
import { memeticUpdate } from "../blackbox/MemeticUpdate.ts";
import { editParentByIndex } from "../breed/EditParentByIndex.ts";
import { geneticCompatibility } from "../breed/GeneticCompatibility.ts";
import { Creature } from "../Creature.ts";
import type { RequiredHyperparameterEvolutionConfig } from "../config/HyperparameterConfig.ts";
import { DEFAULT_HYPERPARAMETER_EVOLUTION_CONFIG } from "../config/HyperparameterConfig.ts";
import { crossoverHyperparameters } from "../NEAT/HyperparameterEvolution.ts";
import { TopologyError } from "../errors/TopologyError.ts";
import { ValidationError } from "../errors/ValidationError.ts";
import { getRandomNumberGenerator } from "../utils/RandomNumberGenerator.ts";
import {
  getMajorVersion,
  prepareCreatureForBreeding,
  upgradeSemanticVersionIfForwardOnlyConfirmed,
} from "../upgrade/Upgrade.ts";
import { writeDiagnostics } from "../utils/Diagnostics.ts";
import { getLogger } from "../utils/Logger.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import { creatureValidate } from "./CreatureValidate.ts";
import { Neuron } from "./Neuron.ts";
import { outputIndexFromId, outputNeuronId } from "./NeuronId.ts";
import type { SynapseExport, SynapseInternal } from "./SynapseInterfaces.ts";

class OffspringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffspringError";
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

export class Offspring {
  /**
   * Create an offspring from two parent networks
   */
  static breed(
    mum: Creature,
    dad: Creature,
    options: {
      geneticCompatibilityThreshold?: number;
      forwardOnly?: boolean;
      hyperparameterEvolution?: RequiredHyperparameterEvolutionConfig;
    } = {},
  ): Creature | undefined {
    const rng = getRandomNumberGenerator();
    // Issue #1095: Use shallowClone() instead of JSON serialisation/deserialisation
    // for parent preparation. shallowClone() is 3-4x faster as it:
    // - Creates new Creature with copied neuron/synapse arrays
    // - Avoids JSON string creation and parsing overhead
    const mother = prepareCreatureForBreeding(mum.shallowClone());
    CreatureUtil.makeUUID(mother);
    let father = prepareCreatureForBreeding(dad.shallowClone());
    CreatureUtil.makeUUID(father);
    assert(
      mother.input === father.input && mother.output === father.output,
      "Parents aren't the same species",
    );

    const compatibility = geneticCompatibility(mother, father);
    let fixAliases = false;
    if (
      options.geneticCompatibilityThreshold &&
      compatibility < options.geneticCompatibilityThreshold
    ) {
      father = editParentByIndex(mother, father);
      CreatureUtil.makeUUID(father);

      fixAliases = true;
    }

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

    const motherMajor = getMajorVersion(mother.semanticVersion);
    const fatherMajor = getMajorVersion(father.semanticVersion);
    const bothParentsFourX = motherMajor >= 4 && fatherMajor >= 4;
    const shouldBeForwardOnly = bothParentsFourX ||
      options.forwardOnly === true ||
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
      );

      // Hidden/constant: keep parent stable uuid; constructor already assigned a
      // random uuid if parent had none (new lineage).
      if (neuron.type === "hidden" || neuron.type === "constant") {
        newNode.uuid = neuron.uuid ?? newNode.uuid;
      }

      addTags(newNode, neuron);

      newNode.index = indx;
      offspring.neurons[indx] = newNode;
      indxMap.set(neuron.id, indx);
    }

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
            if (fromIndx <= toIndx) {
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
            } else {
              throw new TopologyError(
                `${neuron.ID()} fromIndx=${fromIndx} > toIndx=${toIndx}`,
                "INVALID_CONNECTION",
              );
            }
          }
        }
      }
    }

    // Batch connect all synapses with single cache invalidation
    offspring.connectBatch(batchConnections);

    // Apply tags to the created synapses
    for (const conn of batchConnections) {
      if (conn.tags) {
        const synapse = offspring.getSynapse(conn.from, conn.to);
        if (synapse) {
          addTags(synapse, { tags: conn.tags });
        }
      }
    }

    // Issue #1097: Prebuild inward index for large offspring.
    // This optimises subsequent inward connection lookups during validation
    // and memetic updates by avoiding linear scans.
    offspring.prebuildInwardIndexIfLarge();

    // Issue #2086 / GRQ logs: `exportJSON()` is UUID-only (#2054). If two hidden
    // neurons still share a `uuid`, `loadFrom()` maps that uuid to a single index
    // and silently mis-wires synapses. Graft (`fixAliases`) round-trips through
    // export+load — dedupe UUIDs *before* that path (regression vs integer-id alias
    // rewrite, ~Mar 2026).
    Offspring.ensureUniqueNeuronUuids(offspring);

    if (fixAliases) {
      const fixed = offspring.exportJSON();
      for (const n of fixed.neurons) {
        const alias = getTag(n, "alias");
        if (alias && typeof n.uuid === "string") {
          removeTag(n, "alias");
          const oldUuid = n.uuid;
          n.uuid = alias;
          fixed.synapses.forEach((s) => {
            if (s.fromUUID === oldUuid) s.fromUUID = alias;
            if (s.toUUID === oldUuid) s.toUUID = alias;
          });
        }
      }

      offspring.loadFrom(fixed, false);
    }

    offspring.clearState();

    delete offspring.uuid;
    const childUUID = CreatureUtil.makeUUID(offspring);

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

    try {
      creatureValidate(offspring);

      if (
        options.forwardOnly === false && !bothParentsFourX
      ) {
        offspring.forwardOnly = false;
      } else if (shouldBeForwardOnly) {
        if (options.forwardOnly === false && bothParentsFourX) {
          // Two forward-only 4.x parents cannot produce a feedback child; keep
          // the forward-only invariant.
          getLogger().warn(
            `[Offspring] feedbackLoop/memory mode requested but both parents are 4.x; forcing forwardOnly child`,
          );
        }
        offspring.forwardOnly = true;
        try {
          offspring.validate({ forwardOnly: true });
          upgradeSemanticVersionIfForwardOnlyConfirmed(offspring);
        } catch (e) {
          const error = e as ValidationError;
          if (
            error.reason === "SELF_CONNECTION" ||
            error.reason === "RECURSIVE_SYNAPSE"
          ) {
            const violations = offspring.synapses
              .map((s, i) => ({ s, i }))
              .filter(({ s }) => s.from === s.to || s.from > s.to)
              .slice(0, 10)
              .map(({ s, i }) =>
                `${i}) ${s.from} (${
                  offspring.neurons[s.from]?.ID?.() ?? "?"
                }) -> ${s.to} (${offspring.neurons[s.to]?.ID?.() ?? "?"})`
              );

            offspring.DEBUG = false;
            writeDiagnostics({
              error,
              prefix: "offspring-forward-only-violation",
              mother: mother.exportJSON(),
              father: father.exportJSON(),
              offspring: offspring.exportJSON(),
            });
            throw new TopologyError(
              `[Offspring] CRITICAL: forward-only offspring has recurrent connections after breed — ` +
                `do not use fix() to mask this (fitness-destroying). ` +
                `Mother: ${mother.uuid} (${mother.semanticVersion}), ` +
                `Father: ${father.uuid} (${father.semanticVersion}). ` +
                `Error=${error.name}: ${error.message}. ` +
                `Violations: ${violations.join(" | ")}`,
              "INVALID_CONNECTION",
            );
          } else {
            throw e;
          }
        }
      }

      return offspring;
    } catch (e) {
      const error = e as Error;
      const errorName = e instanceof ValidationError
        ? e.reason
        : (error.name ? error.name : "ERROR");
      switch (errorName) {
        case "RECURSIVE_CONNECTION":
          return undefined;
        case "NO_OUTWARD_CONNECTIONS":
          return undefined;
        case "NO_INWARD_CONNECTIONS":
        case "IF_CONDITIONS":
          offspring.DEBUG = false;
          writeDiagnostics({
            error,
            prefix: "offspring-invalid-after-breed",
            mother: mother.exportJSON(),
            father: father.exportJSON(),
            offspring: offspring.exportJSON(),
          });
          throw new TopologyError(
            `[Offspring] CRITICAL: invalid offspring after breed (${errorName}) — ` +
              `fix() is not applied here (it would distort fitness). ` +
              `Original: ${error.message}`,
            "INVALID_CONNECTION",
          );
        case "MEMETIC":
          delete offspring.memetic;
          offspring.validate();
          return offspring;
        default:
          getLogger().error(e);
          offspring.DEBUG = false;
          writeDiagnostics({
            error,
            prefix: "offspring",
            mother: mother.exportJSON(),
            father: father.exportJSON(),
            offspring: offspring.exportJSON(),
          });
          throw e;
      }
    }
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

      return indxA - indxB;
    });

    const usedIndx = new Set<number>();
    let missing = true;
    for (let attempts = 0; missing && attempts < child.length; attempts++) {
      missing = false;
      for (const neuron of child) {
        if (neuron.type !== "input" && neuron.type !== "output") {
          const nId = neuron.id;

          if (!childMap.has(nId)) {
            const firstIndx = firstMap.get(nId);
            const secondIndx = secondMap.get(nId);

            let indx = 0;
            if (firstIndx !== undefined) {
              indx = firstIndx;
            } else if (secondIndx !== undefined) {
              indx = secondIndx;
            } else {
              throw new TopologyError(
                `Can't find ${nId} in father or mother creatures!`,
                "MISSING_NEURON",
              );
            }
            const ref = connectionsMap.get(nId);
            if (ref) {
              const parentNeurons = ref.parent.neurons;
              for (const synapse of ref.synapses) {
                if (indx >= 0) {
                  const fromNeuron = parentNeurons[synapse.from];
                  if (fromNeuron.type !== "input") {
                    const dependantIndx = childMap.get(fromNeuron.id);
                    if (dependantIndx === undefined) {
                      indx = -1;
                    } else if (dependantIndx >= indx) {
                      indx = dependantIndx + 1;
                    }
                  }
                }
              }
            }
            if (indx >= 0) {
              if (usedIndx.has(indx)) {
                childMap.forEach((childIndx, nid) => {
                  if (childIndx >= indx) {
                    usedIndx.delete(childIndx);
                    childIndx++;
                    usedIndx.add(childIndx);
                  }
                  childMap.set(nid, childIndx);
                });
              }
              usedIndx.add(indx);
              childMap.set(nId, indx);
            } else {
              missing = true;
            }
          }
        }
      }
    }

    if (missing) {
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
        return aIndx - bIndx;
      }
    });
  }
}
