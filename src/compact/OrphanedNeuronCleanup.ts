import { assert } from "@std/assert";
import type { Creature } from "../Creature.ts";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import { assertValidSynapseReferences } from "../architecture/AssertValidSynapseReferences.ts";
import { normaliseCreatureExport } from "../architecture/NormaliseCreatureExport.ts";
import { Neuron } from "../architecture/Neuron.ts";
import type { Synapse } from "../architecture/Synapse.ts";
import { CreatureExportBuilder } from "../utils/CreatureExportBuilder.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Activations } from "../methods/activations/Activations.ts";

/**
 * Result of cleaning up orphaned neurons.
 */
export interface CleanupOrphanedResult {
  /** Number of neurons removed. */
  removed: number;
  /** Number of hidden neurons converted to constants. */
  converted: number;
}

export function createConstantOne(creature: Creature, count: number) {
  let id;
  switch (count) {
    case 1:
      id = -1001;
      break;
    case 2:
      id = -1002;
      break;
    default:
      id = -1000;
  }
  let firstHiddenIndx = -1;
  let foundConstant;
  for (let indx = creature.input; indx < creature.neurons.length; indx++) {
    const n = creature.neurons[indx];
    if (firstHiddenIndx === -1) {
      if (n.type === "hidden") {
        firstHiddenIndx = n.index;
      }
    }
    if (n.id === id) {
      assert(n.type === "constant", "Must be a constant");
      foundConstant = n;
      foundConstant.bias = 1;
      if (firstHiddenIndx === -1) {
        firstHiddenIndx = foundConstant.index;
      }

      break;
    }
  }

  const constantOne = new Neuron(
    id,
    "constant",
    1,
    creature,
    undefined,
  );
  constantOne.index = firstHiddenIndx;
  const left = creature.neurons.slice(0, firstHiddenIndx);
  const right = creature.neurons.slice(firstHiddenIndx);
  right.forEach((n) => {
    n.index++;
  });
  creature.neurons = [...left, constantOne, ...right];

  creature.synapses.forEach((c) => {
    if (c.from >= firstHiddenIndx) c.from++;
    if (c.to >= firstHiddenIndx) c.to++;
  });

  if (foundConstant) {
    let firstIndx = -1;
    for (let indx = creature.input; indx < creature.neurons.length; indx++) {
      const n = creature.neurons[indx];
      if (n.id === id) {
        if (firstIndx === -1) {
          firstIndx = n.index;
        } else {
          creature.synapses.forEach((c) => {
            if (c.from === n.index) {
              c.from = firstIndx;
            }
          });

          creature.clearCache();
          removeHiddenNeuron(creature, n.index);
          break;
        }
      }
    }

    creature.synapses.sort((a, b) => {
      if (a.from === b.from) {
        return a.to - b.to;
      } else {
        return a.from - b.from;
      }
    });
  }

  creature.clearCache();

  return constantOne;
}

/**
 *  Removes a node from the creature
 */
export function removeHiddenNeuron(creature: Creature, indx: number) {
  assert(indx >= 0, "Must be a positive integer");

  delete creature.memetic;
  const neuron = creature.neurons[indx];

  assert(
    neuron.type === "constant" || neuron.type === "hidden",
    "Node must be a 'constant' or 'hidden' type",
  );
  const left = creature.neurons.slice(0, indx);
  const right = creature.neurons.slice(indx + 1);
  right.forEach((item) => {
    item.index--;
  });

  const full = [...left, ...right];

  creature.neurons = full;

  const tmpConnections: Synapse[] = [];

  creature.synapses.forEach((c) => {
    if (c.from !== indx) {
      if (c.from > indx) c.from--;
      if (c.to !== indx) {
        if (c.to > indx) c.to--;

        tmpConnections.push(c);
      }
    }
  });

  creature.synapses = tmpConnections;

  // Maintain sorted order: by 'from' index, then by 'to' index
  creature.synapses.sort((a, b) => {
    if (a.from === b.from) {
      return a.to - b.to;
    } else {
      return a.from - b.from;
    }
  });

  creature.clearCache();
}

/**
 * Cleans up orphaned neurons from a CreatureExport.
 *
 * This function handles two types of orphaned neurons:
 * 1. Hidden/constant neurons with no outward connections - these are removed
 * 2. Hidden neurons with no inward connections but with outward connections -
 *    these are converted to constants
 *
 * This can occur when a neuron is removed and other neurons that only
 * connected to/from it are left dangling.
 *
 * This function modifies the CreatureExport in place. The cleanup is performed
 * iteratively until no more orphaned neurons are found (cascade removal).
 *
 * Also cleans up memetic data references to removed neurons.
 *
 * @param creatureExport - The CreatureExport to clean up (modified in place).
 * @returns The cleanup result with counts of removed and converted neurons.
 */
export function cleanupOrphanedNeurons(
  creatureExport: CreatureExport,
): CleanupOrphanedResult {
  normaliseCreatureExport(creatureExport);
  let totalRemoved = 0;
  let totalConverted = 0;
  let changedThisPass: boolean;
  const allRemovedIds = new Set<number>();

  do {
    changedThisPass = false;

    // Build sets for connection analysis
    const neuronsWithOutwardConnections = new Set<number>();
    const neuronsWithInwardConnections = new Set<number>();
    for (const synapse of creatureExport.synapses) {
      neuronsWithOutwardConnections.add(synapse.fromId!);
      neuronsWithInwardConnections.add(synapse.toId!);
    }

    // First pass: Convert hidden neurons with no inward connections (but have outward) to constants
    for (let i = 0; i < creatureExport.neurons.length; i++) {
      const neuron = creatureExport.neurons[i];
      if (neuron.type === "hidden") {
        if (
          !neuronsWithInwardConnections.has(neuron.id!) &&
          neuronsWithOutwardConnections.has(neuron.id!)
        ) {
          // Has outward connections but no inward - convert to constant
          // A hidden neuron with bias X and squash function outputs squash(0 + X)
          // when receiving no input, so we must apply the squash function to get
          // the correct constant value.
          // IMPORTANT: This is a structural rewrite that must preserve f64 precision.
          // Using WASM (f32) here can introduce rounding (eg -0.58 becomes
          // -0.5799999833), which breaks long-standing tests and can change
          // deterministic structure transformations. Call JS squash directly.
          let constantBias = neuron.bias;
          if (neuron.squash) {
            const squashFn = Activations.find(
              neuron.squash,
            );
            // Aggregate activations (IF, MAXIMUM, MINIMUM, etc.) don't have
            // a simple squash(x) method — they operate on multiple inputs.
            // For those, just use the bias as-is.
            if ("squash" in squashFn) {
              constantBias = (squashFn as ActivationInterface).squash(
                neuron.bias,
              );
            }
          }
          // Issue #1972: Preserve neuron tags when converting to constant.
          const constantNeuron: typeof creatureExport.neurons[number] = {
            type: "constant",
            id: neuron.id!,
            bias: constantBias,
          };
          if (neuron.tags) constantNeuron.tags = [...neuron.tags];
          creatureExport.neurons[i] = constantNeuron;
          totalConverted++;
          changedThisPass = true;
        }
      }
    }

    // Second pass: Find and remove neurons with no outward connections
    const orphanedIds: number[] = [];
    for (const neuron of creatureExport.neurons) {
      if (neuron.type === "hidden" || neuron.type === "constant") {
        if (!neuronsWithOutwardConnections.has(neuron.id!)) {
          orphanedIds.push(neuron.id!);
        }
      }
    }

    if (orphanedIds.length > 0) {
      const orphanSet = new Set(orphanedIds);

      // Track all removed UUIDs for memetic cleanup
      for (const uuid of orphanedIds) {
        allRemovedIds.add(uuid);
      }

      // Remove orphaned neurons
      creatureExport.neurons = creatureExport.neurons.filter(
        (n) => !orphanSet.has(n.id!),
      );

      // Remove synapses that connect TO or FROM orphaned neurons.
      // The fromId check is defensive: orphans by definition have no outward
      // connections, but upstream bugs could leave dangling fromId references.
      creatureExport.synapses = creatureExport.synapses.filter(
        (s) => !orphanSet.has(s.toId!) && !orphanSet.has(s.fromId!),
      );

      totalRemoved += orphanedIds.length;
      changedThisPass = true;
    }

    // Integrity assertion: verify no dangling synapse references remain
    // after each iteration of neuron removal and synapse filtering.
    assertValidSynapseReferences(
      creatureExport,
      "cleanupOrphanedNeurons iteration",
    );
  } while (changedThisPass);

  // Delete memetic if any neurons were removed (structure changed)
  if (allRemovedIds.size > 0) {
    delete creatureExport.memetic;
  }

  // Final integrity assertion after all cleanup is complete
  assertValidSynapseReferences(
    creatureExport,
    "cleanupOrphanedNeurons final",
  );

  return { removed: totalRemoved, converted: totalConverted };
}

/**
 * Cleans up orphaned neurons from a live Creature instance.
 *
 * This is a convenience wrapper that exports the creature to JSON (without
 * validation, to allow intermediate invalid states), calls cleanupOrphanedNeurons,
 * and reloads the creature if any modifications were made.
 *
 * This function handles:
 * 1. Converting hidden neurons with no inward connections to constants
 * 2. Removing hidden/constant neurons with no outward connections
 *
 * @param creature - The Creature to clean up (modified in place).
 * @returns The cleanup result with counts of removed and converted neurons.
 */
export function cleanupOrphanedNeuronsInCreature(
  creature: Creature,
): CleanupOrphanedResult {
  // Use the builder directly to bypass validation (creature may be in an intermediate state)
  const builder = new CreatureExportBuilder(creature);
  const exportJSON = builder.build(true);

  const result = cleanupOrphanedNeurons(exportJSON);

  if (result.removed > 0 || result.converted > 0) {
    // This helper is used from repair paths (`fix()`), where the export may be
    // in an intermediate state until the caller finishes all repair steps.
    // Let the outer repair/validation flow perform the final strict validate.
    creature.loadFrom(exportJSON, false);
  }

  return result;
}
