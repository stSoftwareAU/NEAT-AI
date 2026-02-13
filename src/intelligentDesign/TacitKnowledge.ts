/**
 * Tacit Knowledge management for Intelligent Design.
 *
 * Tacit knowledge captures neuron-to-squash mappings that have been discovered
 * to work well. This module provides utilities to apply and update this knowledge.
 *
 * @module
 */

import { assert } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import type { CreatureExport } from "../architecture/CreatureInterfaces.ts";
import type { NeuronExport } from "../architecture/NeuronInterfaces.ts";
import { Creature } from "../Creature.ts";
import { getLogger } from "../utils/Logger.ts";

/**
 * Tacit knowledge is a mapping from neuron UUID to squash function name.
 */
export type TacitKnowledgeMap = Record<string, string>;

/**
 * Result from applying tacit knowledge to a creature.
 */
export interface TacitKnowledgeResult {
  /** The modified creature export (null if no improvements found) */
  improvedCreature: CreatureExport | null;
  /** The improved score (or original score if no improvement) */
  score: number;
  /** The error value */
  error: number;
  /** Human-readable message describing the result */
  message: string;
  /** Number of neurons that were adjusted */
  adjustedNeurons: number;
  /** Updated local knowledge (after removing failed substitutions) */
  localKnowledge: TacitKnowledgeMap;
  /** Updated combined knowledge (after removing failed substitutions) */
  combinedKnowledge: TacitKnowledgeMap;
}

/**
 * Options for applying tacit knowledge.
 */
export interface ApplyTacitKnowledgeOptions {
  /** The creature export to modify */
  creature: CreatureExport;
  /** The current best score of the creature */
  bestScore: number;
  /** The current error of the creature */
  bestError: number;
  /** Directory containing scoring data */
  dataDir: string;
  /** Local knowledge (machine-specific, takes precedence) */
  localKnowledge: TacitKnowledgeMap;
  /** Hive knowledge (shared across machines) */
  hiveKnowledge: TacitKnowledgeMap;
  /** NEAT options for scoring (can include customCost) */
  options?: object;
  /** Epsilon for score comparison (default: 1e-8) */
  epsilon?: number;
}

/**
 * Creates a modified creature with a neuron's squash function changed.
 *
 * @param neuronUUID - The UUID of the neuron to modify
 * @param creatureExport - The creature export to modify
 * @param nextSquash - The new squash function to apply
 * @returns The modified creature
 */
export function makeModifiedCreature(
  neuronUUID: string,
  creatureExport: CreatureExport,
  nextSquash: string,
): Creature {
  const tmpJson = Creature.fromJSON(creatureExport).exportJSON();
  const neuronData = tmpJson.neurons.find((n: NeuronExport) =>
    n.uuid === neuronUUID
  );
  assert(neuronData, "Neuron not found in the creature JSON");
  const previousSquash = neuronData.squash;
  assert(previousSquash, "Previous squash should be defined");

  if (neuronData.squash === nextSquash) {
    getLogger().warn(
      `${neuronData.uuid.slice(-8)} Squash already set to ${nextSquash}`,
    );
  }

  neuronData.squash = nextSquash;
  addTag(
    neuronData,
    "intelligentDesign",
    `${previousSquash} -> ${nextSquash}`,
  );

  return Creature.fromJSON(tmpJson);
}

/**
 * Validates neuron UUIDs against the creature and returns a map of valid neurons.
 *
 * @param creatureExport - The creature export to validate against
 * @returns Map of neuron UUID to current squash function
 */
export function getValidNeuronSquashes(
  creatureExport: CreatureExport,
): Map<string, string> {
  const validNeuronUUIDs = new Map<string, string>();
  creatureExport.neurons.forEach((n: NeuronExport) => {
    if (n.type === "hidden" && n.uuid && n.squash) {
      validNeuronUUIDs.set(n.uuid, n.squash);
    }
  });
  return validNeuronUUIDs;
}

/**
 * Cleans knowledge maps by removing entries for neurons that don't exist
 * in the creature.
 *
 * @param validNeuronUUIDs - Map of valid neuron UUIDs
 * @param localKnowledge - Local knowledge to clean
 * @param hiveKnowledge - Hive knowledge to clean
 * @returns Cleaned knowledge maps
 */
export function cleanKnowledge(
  validNeuronUUIDs: Map<string, string>,
  localKnowledge: TacitKnowledgeMap,
  hiveKnowledge: TacitKnowledgeMap,
): { localKnowledge: TacitKnowledgeMap; hiveKnowledge: TacitKnowledgeMap } {
  const cleanedLocal = { ...localKnowledge };
  const cleanedHive = { ...hiveKnowledge };

  // Remove invalid entries from local knowledge
  for (const key of Object.keys(cleanedLocal)) {
    if (!validNeuronUUIDs.has(key)) {
      delete cleanedLocal[key];
    }
  }

  // Remove invalid entries from hive knowledge
  for (const key of Object.keys(cleanedHive)) {
    const creatureSquash = validNeuronUUIDs.get(key);
    if (!creatureSquash) {
      getLogger().warn(
        `Removing invalid hive knowledge for ${
          key.slice(-8)
        }: not found in the creature.`,
      );
      delete cleanedHive[key];
    }
  }

  // Add missing neurons to hive knowledge
  validNeuronUUIDs.forEach((squash, uuid) => {
    if (!cleanedHive[uuid]) {
      getLogger().warn(
        `No hive knowledge for ${
          uuid.slice(-8)
        } with squash ${squash}, adding.`,
      );
      cleanedHive[uuid] = squash;
    }
  });

  return { localKnowledge: cleanedLocal, hiveKnowledge: cleanedHive };
}

/**
 * Combines local and hive knowledge with local taking precedence.
 *
 * @param localKnowledge - Local knowledge (takes precedence)
 * @param hiveKnowledge - Hive knowledge
 * @returns Combined knowledge map
 */
export function combineKnowledge(
  localKnowledge: TacitKnowledgeMap,
  hiveKnowledge: TacitKnowledgeMap,
): TacitKnowledgeMap {
  return {
    ...hiveKnowledge,
    ...localKnowledge,
  };
}

/**
 * Gets neurons that need to be tested based on combined knowledge.
 *
 * Returns neurons where the combined knowledge suggests a different squash
 * function than currently used.
 *
 * @param creatureExport - The creature export
 * @param combinedKnowledge - Combined tacit knowledge
 * @returns Array of neurons to test
 */
export function getNeuronsToTest(
  creatureExport: CreatureExport,
  combinedKnowledge: TacitKnowledgeMap,
): NeuronExport[] {
  return creatureExport.neurons.filter(
    (n: NeuronExport) =>
      n.type === "hidden" &&
      combinedKnowledge[n.uuid] &&
      n.squash !== combinedKnowledge[n.uuid],
  );
}

/**
 * Applies squash changes from a neuron map to a creature and scores the result.
 *
 * @param creatureExport - The original creature export
 * @param neuronSquashMap - Map of neuron UUID to squash info
 * @param dataDir - Directory containing scoring data
 * @param options - Scoring options
 * @returns The final creature export with tags applied
 */
export async function applyNeuronChanges(
  creatureExport: CreatureExport,
  neuronSquashMap: Map<
    string,
    { squash: string; score: number; error: number }
  >,
  dataDir: string,
  options: object,
): Promise<{ creature: CreatureExport; score: number; error: number }> {
  const finalJson = Creature.fromJSON(creatureExport).exportJSON();

  for (const uuid of neuronSquashMap.keys()) {
    const neuron = finalJson.neurons.find((n: NeuronExport) => n.uuid === uuid);
    assert(neuron, "Neuron not found in the final JSON");
    const { squash } = neuronSquashMap.get(uuid)!;

    if (neuron.squash === squash) {
      continue;
    }

    const previousSquash = neuron.squash;
    neuron.squash = squash;
    addTag(
      neuron,
      "intelligentDesign",
      `${previousSquash} -> ${squash}`,
    );
  }

  const finalCreature = Creature.fromJSON(finalJson);
  finalCreature.fix();
  const result = await finalCreature.scoreDir(dataDir, options);

  const exported = finalCreature.exportJSON();
  addTag(exported, "score", `${result.score}`);
  addTag(exported, "error", `${result.error}`);

  return {
    creature: exported,
    score: result.score,
    error: result.error,
  };
}
