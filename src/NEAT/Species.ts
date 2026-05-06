import type { Creature } from "@creature";
import { generate as generateV5Sync } from "@architecture/SyncV5.ts";

/**
 * Architecture information for species classification.
 * Issue #1038: Architecture-based species management.
 */
export interface ArchitectureInfo {
  /** Neuron count bucket (groups creatures by size range) */
  neuronCountBucket: number;
  /** Connectivity bucket (groups creatures by connection density) */
  connectivityBucket: number;
  /** Squash function distribution string (sorted for consistency) */
  squashDistribution: string;
}

/**
 * Size bucket thresholds for hidden neuron count.
 * Each bucket represents a range of hidden neurons, e.g.:
 * - Bucket 0: 0-9 hidden neurons
 * - Bucket 1: 10-19 hidden neurons
 * - Bucket 2: 20-29 hidden neurons
 * - etc.
 */
const NEURON_BUCKET_SIZE = 10;

/**
 * Connectivity bucket thresholds (connections per neuron).
 * - Bucket 0: 0-1.99 connections per neuron (sparse)
 * - Bucket 1: 2-3.99 connections per neuron (moderate)
 * - Bucket 2: 4+ connections per neuron (dense)
 */
const CONNECTIVITY_BUCKET_SIZE = 2;

/**
 * Per-species rolling statistics computed once per generation.
 *
 * Issue #2452: Foundational telemetry for fitness sharing. The species's
 * adjusted fitness is the best raw fitness divided by species size — a
 * single representative value suitable for downstream fitness-sharing
 * selection. A species of size 1 therefore has adjusted fitness equal
 * to its raw fitness.
 *
 * Statistics are reset to neutral values until {@link Species.computeStatistics}
 * runs for the current generation.
 */
export class Species {
  private static TE = new TextEncoder();
  private static NAMESPACE_UUID = "1b671a64-40d5-491e-99b0-ac01ff1f5641";

  creatures: Creature[];
  lastCreature: Creature | undefined;

  readonly speciesKey: string;

  /**
   * Issue #2530: Optional sub-task tag binding this species to a specific
   * objective in a multi-objective fitness function. When set, the species
   * is a "specialist" — its members are ranked against {@link specialistTaskId}'s
   * sub-score during selection, while still contributing to the global
   * breeding pool size. {@link SpecialistPipeline} owns the lifecycle.
   *
   * `undefined` indicates a generalist (standard topology-only species).
   */
  specialistTaskId?: string;

  /**
   * Issue #2452: Per-species rolling statistics. These are populated by
   * {@link computeStatistics}, called once per generation as part of
   * speciation, before parent selection runs.
   */
  size: number = 0;
  bestRawFitness: number = -Infinity;
  meanRawFitness: number = 0;
  /**
   * Adjusted (fitness-shared) fitness for this species: the best raw
   * fitness divided by the species size. For a species of size 1, this
   * equals the member's raw fitness.
   */
  adjustedFitness: number = -Infinity;

  constructor(speciesKey: string) {
    this.speciesKey = speciesKey;
    this.creatures = [];
  }

  addCreature(creature: Creature) {
    this.lastCreature = creature;
    this.creatures.push(creature);
  }

  /**
   * Issue #2452: Recompute per-species rolling statistics from the
   * current member creatures. Members without a finite numeric score
   * are skipped so that pre-fitness or panicked creatures do not poison
   * the mean. Call this once per generation, after fitness evaluation
   * and before parent selection runs.
   */
  computeStatistics(): void {
    this.size = this.creatures.length;
    if (this.size === 0) {
      this.bestRawFitness = -Infinity;
      this.meanRawFitness = 0;
      this.adjustedFitness = -Infinity;
      return;
    }
    let best = -Infinity;
    let sum = 0;
    let counted = 0;
    for (const c of this.creatures) {
      const score = c.score;
      if (score === undefined || score === null || !Number.isFinite(score)) {
        continue;
      }
      if (score > best) best = score;
      sum += score;
      counted++;
    }
    if (counted === 0) {
      this.bestRawFitness = -Infinity;
      this.meanRawFitness = 0;
      this.adjustedFitness = -Infinity;
      return;
    }
    this.bestRawFitness = best;
    this.meanRawFitness = sum / counted;
    // Adjusted = raw / speciesSize. By construction, size === 1 ⇒
    // adjustedFitness === bestRawFitness === rawFitness of the sole member.
    this.adjustedFitness = best / this.size;
  }

  /**
   * Get architecture information for a creature.
   * Issue #1038: Extract architectural metrics for species classification.
   *
   * @param creature The creature to analyse
   * @returns Architecture information including neuron count bucket, connectivity bucket, and squash distribution
   */
  static getArchitectureInfo(creature: Creature): ArchitectureInfo {
    // Count hidden neurons (exclude input and output neurons)
    const hiddenNeuronCount = creature.neurons.length - creature.output;

    // Calculate neuron count bucket
    const neuronCountBucket = Math.floor(
      hiddenNeuronCount / NEURON_BUCKET_SIZE,
    );

    // Calculate connectivity: synapses per non-input neuron
    const nonInputNeuronCount = creature.neurons.length;
    const synapseCount = creature.synapses.length;
    const connectivityRatio = nonInputNeuronCount > 0
      ? synapseCount / nonInputNeuronCount
      : 0;
    const connectivityBucket = Math.floor(
      connectivityRatio / CONNECTIVITY_BUCKET_SIZE,
    );

    // Calculate squash function distribution
    // Group squashes and count them, then create a sorted string representation
    const squashCounts = new Map<string, number>();
    for (const neuron of creature.neurons) {
      const squash = neuron.squash ?? "IDENTITY";
      const count = squashCounts.get(squash) || 0;
      squashCounts.set(squash, count + 1);
    }

    // Create distribution string with counts bucketed to avoid too many species
    // Bucket counts: 1-2 -> "L" (low), 3-5 -> "M" (medium), 6+ -> "H" (high)
    const squashEntries = Array.from(squashCounts.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([squash, count]) => {
        const bucket = count <= 2 ? "L" : count <= 5 ? "M" : "H";
        return `${squash}:${bucket}`;
      });

    const squashDistribution = squashEntries.join(",");

    return {
      neuronCountBucket,
      connectivityBucket,
      squashDistribution,
    };
  }

  /**
   * Calculate species key based on creature architecture.
   * Issue #1038: Incorporate network architecture into species key.
   *
   * The key now includes:
   * - Neuron count range (bucketed)
   * - Connectivity density (bucketed)
   * - Squash function distribution
   *
   * This ensures creatures with vastly different architectures are placed
   * in different species, improving crossover compatibility.
   */
  static calculateKey(creature: Creature): string {
    const archInfo = Species.getArchitectureInfo(creature);

    // Build the key string from architectural components
    const keyComponents = [
      `N${archInfo.neuronCountBucket}`, // Neuron count bucket
      `C${archInfo.connectivityBucket}`, // Connectivity bucket
      archInfo.squashDistribution, // Squash distribution
    ];

    const keyString = keyComponents.join("|");
    const data = Species.TE.encode(keyString);

    const uuid: string = generateV5Sync(Species.NAMESPACE_UUID, data);
    return uuid;
  }
}
