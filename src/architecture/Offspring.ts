import { assert } from "@std/assert";
import { addTags, getTag, removeTag } from "@stsoftware/tags/mod";
import { memeticUpdate } from "../blackbox/MemeticUpdate.ts";
import { editParentByIndex } from "../breed/EditParentByIndex.ts";
import { geneticCompatibility } from "../breed/GeneticCompatibility.ts";
import { Creature } from "../Creature.ts";
import {
  getMajorVersion,
  upgrade,
  upgradeSemanticVersionIfForwardOnlyConfirmed,
} from "../upgrade/Upgrade.ts";
import { writeDiagnostics } from "../utils/Diagnostics.ts";
import { getLogger } from "../utils/Logger.ts";
import { CreatureUtil } from "./CreatureUtils.ts";
import { creatureValidate } from "./CreatureValidate.ts";
import { Neuron } from "./Neuron.ts";
import type { SynapseExport, SynapseInternal } from "./SynapseInterfaces.ts";

class OffspringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "OffspringError";
  }
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
    } = {},
  ): Creature | undefined {
    // Issue #1095: Use shallowClone() instead of JSON serialisation/deserialisation
    // for parent preparation. shallowClone() is 3-4x faster as it:
    // - Creates new Creature with copied neuron/synapse arrays
    // - Avoids JSON string creation and parsing overhead
    const mother = upgrade(mum.shallowClone());
    CreatureUtil.makeUUID(mother);
    let father = upgrade(dad.shallowClone());
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

    // Pre-build Maps for O(1) neuron lookup by UUID.
    // This replaces O(n) linear .find() searches, improving breeding performance
    // from O(n²) to O(n) for creatures with many neurons. (Issue #1024)
    const motherNeuronMap = new Map<string, Neuron>();
    for (const neuron of mother.neurons) {
      motherNeuronMap.set(neuron.uuid, neuron);
    }
    const fatherNeuronMap = new Map<string, Neuron>();
    for (const neuron of father.neurons) {
      fatherNeuronMap.set(neuron.uuid, neuron);
    }

    // Determine offspring semantic version based on BOTH parents.
    // Only start at 4.x if BOTH parents are 4.x (forward-only guaranteed).
    // Otherwise start at the lower version - validation will upgrade if appropriate.
    const motherMajor = getMajorVersion(mother.semanticVersion);
    const fatherMajor = getMajorVersion(father.semanticVersion);
    const bothParentsFourX = motherMajor >= 4 && fatherMajor >= 4;
    const shouldBeForwardOnly = bothParentsFourX ||
      options.forwardOnly === true ||
      (options.forwardOnly === undefined &&
        (mother.forwardOnly === true || father.forwardOnly === true));

    const offspringVersion = shouldBeForwardOnly
      ? ((motherMajor >= 4 && fatherMajor >= 4)
        ? mother.semanticVersion
        : (motherMajor < fatherMajor
          ? mother.semanticVersion
          : father.semanticVersion))
      : "2.0.0";

    // Initialize offspring
    const offspring = new Creature(mother.input, mother.output, {
      lazyInitialization: true,
      semanticVersion: offspringVersion,
    });
    offspring.synapses = [];
    offspring.neurons = [];

    const neuronMap = new Map<string, Neuron>();
    const connectionsMap = new Map<string, SynapseExport[]>();

    // Populate neuronMap and connectionsMap with neurons and synapses from both parents
    for (const node of mother.neurons) {
      if (node.type !== "input") {
        neuronMap.set(node.uuid, node);
        const connections = mother.inwardConnections(node.index);
        Offspring.fixType(node, connections);
        connectionsMap.set(
          node.uuid,
          Offspring.cloneConnections(mother, connections),
        );
      }
    }

    for (const node of father.neurons) {
      if (node.type !== "input") {
        if (Math.random() >= 0.5) {
          const connections = father.inwardConnections(node.index);

          Offspring.fixType(node, connections);
          const tmpConnections = Offspring.cloneConnections(
            father,
            connections,
          );

          neuronMap.set(node.uuid, node);
          connectionsMap.set(node.uuid, tmpConnections);
        }
      }
    }

    // Ensure all neurons are in neuronMap
    let addedMissing;
    do {
      addedMissing = false;
      for (const uuid of neuronMap.keys()) {
        const connections = connectionsMap.get(uuid);
        if (connections) {
          for (const connection of connections) {
            let fromNeuron = neuronMap.get(connection.fromUUID);
            if (!fromNeuron) {
              // Use pre-built Maps for O(1) lookup instead of O(n) .find()
              const motherNeuron = motherNeuronMap.get(connection.fromUUID);
              fromNeuron = motherNeuron;
              let parent = mother;
              if (!fromNeuron || Math.random() >= 0.5) {
                const fatherNeuron = fatherNeuronMap.get(connection.fromUUID);
                if (fatherNeuron) {
                  fromNeuron = fatherNeuron;
                  parent = father;
                }
              }
              if (!fromNeuron) {
                throw new Error(`Can't find ${connection.fromUUID}`);
              }

              neuronMap.set(fromNeuron.uuid, fromNeuron);
              const parentConnections = parent.inwardConnections(
                fromNeuron.index,
              );
              connectionsMap.set(
                fromNeuron.uuid,
                Offspring.cloneConnections(parent, parentConnections),
              );
              addedMissing = true;
            }
          }
        } else {
          throw new Error(`Can't find connections for ${uuid}`);
        }
      }
    } while (addedMissing);

    // Function to clone nodes and create the offspring network
    const tmpNodes: Neuron[] = [];
    const tmpUUIDs = new Set<string>();

    function cloneNode(neuron: Neuron) {
      if (!tmpUUIDs.has(neuron.uuid)) {
        const connections = connectionsMap.get(neuron.uuid);
        if (!connections) {
          throw new Error(`Can't find connections for ${neuron.uuid}`);
        }
        tmpUUIDs.add(neuron.uuid);
        connections.forEach((connection) => {
          const fromNeuron = neuronMap.get(connection.fromUUID);
          if (!fromNeuron) {
            throw new Error(`Can't find ${connection.fromUUID}`);
          } else if (fromNeuron.type !== "input") {
            cloneNode(fromNeuron);
          }
        });
        tmpNodes.push(neuron);
      }
    }

    // Add input neurons
    for (let indx = 0; indx < mother.input; indx++) {
      const input = mother.neurons[indx];
      tmpNodes.push(input);
      tmpUUIDs.add(input.uuid);
    }

    // Add output neurons
    for (let indx = mother.output; indx--;) {
      const node = neuronMap.get(`output-${indx}`);
      if (node !== undefined) {
        cloneNode(node);
      } else {
        throw new Error(`Can't find output-${indx}`);
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

    offspring.neurons.length = tmpNodes.length;
    const indxMap = new Map<string, number>();
    tmpNodes.forEach((neuron, indx) => {
      const newNode = new Neuron(
        neuron.uuid,
        neuron.type,
        neuron.bias,
        offspring,
        neuron.squash,
      );

      addTags(newNode, neuron);

      newNode.index = indx;
      offspring.neurons[indx] = newNode;
      indxMap.set(neuron.uuid, indx);
    });

    // Issue #1102: Collect all connections first, then batch connect
    // This reduces cache invalidation overhead from O(n) to O(1)
    const batchConnections: Array<{
      from: number;
      to: number;
      weight: number;
      type?: "positive" | "negative" | "condition";
      tags?: SynapseExport["tags"];
    }> = [];

    // Track connections to avoid duplicates (matching original getSynapse check)
    const connectionSet = new Set<string>();

    offspring.neurons.forEach((neuron) => {
      if (neuron.type !== "input") {
        const connections = connectionsMap.get(neuron.uuid);
        if (!connections) {
          throw new Error(`Can't find connections for ${neuron.uuid}`);
        }
        connections.forEach((c) => {
          const fromIndx = indxMap.get(c.fromUUID);
          const toIndx = indxMap.get(c.toUUID);

          if (fromIndx !== undefined && toIndx !== undefined) {
            if (fromIndx <= toIndx) {
              const toType = offspring.neurons[toIndx].type;
              if (toType === "hidden" || toType === "output") {
                const key = `${fromIndx}-${toIndx}`;
                if (!connectionSet.has(key)) {
                  connectionSet.add(key);
                  batchConnections.push({
                    from: fromIndx,
                    to: toIndx,
                    weight: c.weight,
                    type: c.type,
                    tags: c.tags,
                  });
                }
              } else {
                throw new Error(
                  `Can't connect to ${toType} neuron at indx=${toIndx} of type ${toType}!`,
                );
              }
            } else {
              throw new Error(
                `${neuron.ID()} fromIndx=${fromIndx} > toIndx=${toIndx}`,
              );
            }
          }
        });
      }
    });

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

    if (fixAliases) {
      const fixed = offspring.exportJSON();
      for (let i = 0; i < fixed.neurons.length; i++) {
        const n = fixed.neurons[i];
        const alias = getTag(n, "alias");
        if (alias) {
          removeTag(n, "alias");
          const oldUUID = n.uuid;
          (n as { uuid: string }).uuid = alias;
          fixed.synapses.forEach((s) => {
            if (s.fromUUID === oldUUID) s.fromUUID = alias;
            if (s.toUUID === oldUUID) s.toUUID = alias;
          });
        }
      }

      offspring.loadFrom(fixed, false);
    }

    if (mother.memetic) {
      const memetic = memeticUpdate(mother, offspring);
      offspring.memetic = memetic;
    } else if (father.memetic) {
      const memetic = memeticUpdate(father, offspring);
      offspring.memetic = memetic;
    }

    try {
      creatureValidate(offspring);

      if (
        options.forwardOnly === false && !bothParentsFourX
      ) {
        // Feedback/memory mode explicitly requested. Ensure we do not create a
        // semanticVersion 4.x creature (4.x is a hard "forward-only" invariant).
        offspring.forwardOnly = false;
        offspring.semanticVersion = "2.0.0";
      } else if (shouldBeForwardOnly) {
        if (options.forwardOnly === false && bothParentsFourX) {
          // Two 4.x parents are a hard forward-only invariant. If a caller requests
          // feedback/memory mode here, it's a misuse of the API. We override it to
          // keep invariants stable and avoid producing a "4.x but not forwardOnly"
          // creature that later fails upgrade/validation.
          getLogger().warn(
            `[Offspring] feedbackLoop/memory mode requested but both parents are 4.x; forcing forwardOnly child`,
          );
        }
        offspring.forwardOnly = true;
        try {
          offspring.validate({ forwardOnly: true });
          upgradeSemanticVersionIfForwardOnlyConfirmed(offspring);
        } catch (e) {
          const error = e as Error;
          if (
            error.name === "SELF_CONNECTION" ||
            error.name === "RECURSIVE_SYNAPSE"
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

            // If BOTH parents are 4.x, this is a bug in the breeding logic
            if (bothParentsFourX) {
              throw new Error(
                `[Offspring] CRITICAL: Both parents are 4.x but offspring has recurrent connections. ` +
                  `This is a bug in the breeding logic that must be fixed. ` +
                  `Mother: ${mother.uuid} (${mother.semanticVersion}), ` +
                  `Father: ${father.uuid} (${father.semanticVersion}). ` +
                  `Error=${error.name}: ${error.message}. ` +
                  `Violations: ${violations.join(" | ")}`,
              );
            }

            // If either parent is 2.x, fixing is expected and OK
            getLogger().warn(
              `[Offspring] Forward-only violation after breed() with 2.x parent. ` +
                `Fixing offspring. Error=${error.name}: ${error.message}. ` +
                `Violations(sample up to 10): ${violations.join(" | ")}`,
            );
            offspring.fix({ forwardOnly: true });
            upgradeSemanticVersionIfForwardOnlyConfirmed(offspring);
          } else {
            throw e;
          }
        }
      }

      return offspring;
    } catch (e) {
      const error = e as Error;
      const errorName = error.name ? error.name : "ERROR";
      switch (errorName) {
        case "RECURSIVE_CONNECTION":
          return undefined;
        case "NO_OUTWARD_CONNECTIONS":
          return undefined;
        case "NO_INWARD_CONNECTIONS":
        case "IF_CONDITIONS":
          offspring.fix();
          creatureValidate(offspring);
          return offspring;
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

  public static cloneConnections(
    creature: Creature,
    connections: SynapseInternal[],
  ): SynapseExport[] {
    const tmpConnections: SynapseExport[] = [];

    connections.forEach((connection) => {
      const c: SynapseExport = {
        fromUUID: creature.neurons[connection.from].uuid,
        toUUID: creature.neurons[connection.to].uuid,
        weight: connection.weight,
        type: connection.type,
        tags: connection.tags,
      };
      tmpConnections.push(c);
    });

    return tmpConnections;
  }

  public static sortNeurons(
    child: Neuron[],
    mother: Neuron[],
    father: Neuron[],
    connectionsMap: Map<string, SynapseExport[]>,
  ) {
    const childMap = new Map<string, number>();

    mother.forEach((neuron, indx) => {
      if (neuron.type === "input") childMap.set(neuron.uuid, indx);
    });

    const mumMap = new Map<string, number>();
    const dadMap = new Map<string, number>();

    mother.forEach((node, indx) => {
      mumMap.set(node.uuid, indx);
    });

    father.forEach((node, indx) => {
      dadMap.set(node.uuid, indx);
    });

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
        return Number.parseInt(a.uuid.substring(7)) -
          Number.parseInt(b.uuid.substring(7));
      } else if (b.type === "output") {
        return -1;
      }

      if (a.uuid === b.uuid) {
        throw new Error(`Duplicate uuid ${a.uuid}`);
      }
      let indxA = firstMap.get(a.uuid);
      if (indxA === undefined) {
        indxA = secondMap.get(a.uuid);
        if (indxA === undefined) throw new Error(`Can't find ${a.uuid}`);
        indxA += 0.1;
      }

      let indxB = firstMap.get(b.uuid);
      if (indxB === undefined) {
        indxB = secondMap.get(b.uuid);
        if (indxB === undefined) throw new Error(`Can't find ${b.uuid}`);
        indxB += 0.1;
      }

      if (indxA === indxB) throw new Error(`Duplicate index ${indxA}`);

      return indxA - indxB;
    });

    const usedIndx = new Set<number>();
    let missing = true;
    for (let attempts = 0; missing && attempts < child.length; attempts++) {
      missing = false;
      child.forEach((neuron) => {
        if (neuron.type !== "input" && neuron.type !== "output") {
          const uuid = neuron.uuid;

          if (!childMap.has(uuid)) {
            const firstIndx = firstMap.get(uuid);
            const secondIndx = secondMap.get(uuid);

            let indx = 0;
            if (firstIndx !== undefined) {
              indx = firstIndx;
            } else if (secondIndx !== undefined) {
              indx = secondIndx;
            } else {
              throw new Error(
                `Can't find ${uuid} in father or mother creatures!`,
              );
            }
            connectionsMap.get(uuid)?.forEach((connection) => {
              if (indx >= 0) {
                const fromUUID = connection.fromUUID;
                if (!fromUUID.startsWith("input-")) {
                  const dependantIndx = childMap.get(fromUUID);
                  if (dependantIndx === undefined) {
                    indx = -1;
                  } else if (dependantIndx >= indx) {
                    indx = dependantIndx + 1;
                  }
                }
              }
            });
            if (indx >= 0) {
              if (usedIndx.has(indx)) {
                childMap.forEach((childIndx, uuid) => {
                  if (childIndx >= indx) {
                    usedIndx.delete(childIndx);
                    childIndx++;
                    usedIndx.add(childIndx);
                  }
                  childMap.set(uuid, childIndx);
                });
              }
              usedIndx.add(indx);
              childMap.set(uuid, indx);
            } else {
              missing = true;
            }
          }
        }
      });
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
        const aIndx = Number.parseInt(a.uuid.substring(7));
        const bIndx = Number.parseInt(b.uuid.substring(7));

        return aIndx - bIndx;
      } else if (b.type === "output") {
        return -1;
      } else if (a.type === "input" && b.type === "input") {
        return a.index - b.index;
      } else {
        const aIndx = childMap.get(a.uuid);
        if (aIndx === undefined) throw new Error(`Can't find ${a.uuid}`);
        const bIndx = childMap.get(b.uuid);
        if (bIndx === undefined) throw new Error(`Can't find ${b.uuid}`);

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
