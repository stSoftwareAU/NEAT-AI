/**
 * Discovery Candidates Coordinator
 *
 * This module coordinates the building of discovery candidates from discovery results.
 * It delegates to focused modules for specific concerns:
 *
 * - **CandidateCreation.ts** — building individual candidate types (add neuron, add synapse, change squash)
 * - **CombinedCandidates.ts** — multi-step combination strategies and phase-2 scoring
 * - **CandidateApplication.ts** — validation and applying candidates to creatures
 * - **CandidateScoring.ts** — expected improvement calculations
 * - **CandidateDescriptions.ts** — emoji selection and human-readable descriptions
 *
 * **Validation Strategy:**
 *
 * We follow a strict validation-first approach to avoid creating broken creatures:
 *
 * 1. **Always validate first**: Every creature modification should call `validate()` before
 *    considering `fix()`. If validation passes, no fix is needed - this is the preferred path.
 *
 * 2. **Reuse battle-hardened logic**: The `src/mutate` classes contain well-tested logic
 *    for modifying creatures without breaking them. Where possible, we should reuse this
 *    logic (DRY principle) rather than reimplementing modification logic here.
 *
 * 3. **Fix() is a bug indicator**: If `validate()` fails and we must call `fix()`, this
 *    indicates a bug in our modification logic that should be addressed.
 *
 * **Goal**: Minimise `fix()` calls by improving modification logic to create valid
 * creatures from the start, following patterns from `src/mutate` classes.
 */

import { CreatureUtil } from "../architecture/CreatureUtils.ts";
import type {
  CandidateHarmfulNeuron,
  CandidateNeuron,
  CandidateSquash,
  CandidateSynapse,
} from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type {
  DiscoverResult,
  RemovalCandidate,
} from "../architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import type {
  CoordinatedStructuralCandidate,
} from "../architecture/ErrorGuidedStructuralEvolution/CoordinatedStructuralCandidate.ts";
import type { Creature } from "../Creature.ts";

// Re-export from focused modules for backwards compatibility
export { shortID } from "./CandidateDescriptions.ts";
export {
  buildCombinedFromSuccessful,
  pruneSuccessfulCandidatesForCombos,
} from "./CombinedCandidates.ts";

import {
  buildCoordinatedStructuralCandidates,
  buildHarmfulNeuronRemovalCandidate,
  buildHarmfulSynapseRemovalCandidates,
  buildLowImpactRemovalCandidates,
  buildSingleNeuronCandidates,
  buildSingleSquashCandidates,
  buildSingleSynapseCandidates,
} from "./CandidateCreation.ts";
import {
  buildBestOfCategoryCandidate,
  buildCombinedCandidate,
  buildCombinedNeuronCandidate,
  buildCombinedSquashCandidates,
  buildCombinedSynapseCandidate,
  persistentlyRemoveHarmfulSynapse,
} from "./CombinedCandidates.ts";

export type DiscoveryChangeType =
  | "add-synapses"
  | "add-neurons"
  | "coordinated-structural"
  | "remove-synapse"
  | "remove-neuron"
  | "remove-low-impact"
  | "change-squash"
  | "combo-add-remove"
  | "combo-add-change"
  | "combo-all"
  | "combo-best-of-category"
  | "combo-successful";

/** Details of a discovered neuron for logging/debugging. */
export interface DiscoveredNeuronDetails {
  /** Short ID of the newly added hidden neuron (from creature after adding). */
  addedNeuronShortID?: string;
  /** Source neuron UUID. */
  fromNeuronUUID: string;
  /** Target neuron UUID. */
  toNeuronUUID: string;
  /** Incoming weight (source -> new neuron). */
  incomingWeight: number;
  /** Outgoing weight (new neuron -> target). */
  outgoingWeight: number;
  /** Bias of the new neuron. */
  bias: number;
  /** Activation function (squash) of the new neuron. */
  squash: string;
}

/** Details of a synapse removal for caching/logging. */
export interface SynapseRemovalDetails {
  /** Source neuron UUID. */
  fromNeuronUUID: string;
  /** Target neuron UUID. */
  toNeuronUUID: string;
}

export interface DiscoveryCandidateChange {
  type: DiscoveryChangeType;
  description?: string;
  expectedErrorReduction?: number;
  sampleSize?: number;
  /** Details of discovered neurons (for single neuron candidates). */
  neuronDetails?: DiscoveredNeuronDetails;
  /** Original Rust coordinated structural candidate response (for coordinated-structural candidates). */
  coordinatedStructuralCandidate?: CoordinatedStructuralCandidate;
  /** Details of synapse removal (for synapse removal candidates). */
  synapseDetails?: SynapseRemovalDetails;
  /** Original Rust synapse candidate response (for add-synapses candidates). */
  synapseCandidate?: CandidateSynapse;
  /** Original Rust neuron candidate response (for add-neurons candidates). */
  neuronCandidate?: CandidateNeuron;
  /** Original Rust squash candidate response (for change-squash candidates). */
  squashCandidate?: CandidateSquash;
  /** Original Rust removal candidate response (for remove-low-impact candidates). */
  removalCandidate?: RemovalCandidate;
  /** Original harmful neuron candidate response (for remove-neuron candidates). */
  harmfulNeuronCandidate?: CandidateHarmfulNeuron;
  /** Original harmful synapse candidate response (for remove-synapse candidates). */
  harmfulSynapseCandidate?: CandidateSynapse;
}

export interface DiscoveryCandidate {
  creature: Creature;
  change: DiscoveryCandidateChange;
}

export interface ScoredDiscoveryCandidate {
  candidate: DiscoveryCandidate;
  /** Measured score delta (candidateScore - originalScore) from Phase 1. */
  scoreDelta: number;
}

export interface BuildDiscoveryCandidatesOptions {
  /**
   * If true, skip building combined candidates.
   * Used for two-phase scoring where combos are built after evaluating singles.
   * @default false
   */
  skipCombinedCandidates?: boolean;

  /**
   * Directory path to cache discovery failures and log validation issues.
   * When provided, validation issues are recorded to an "issues" subdirectory.
   */
  discoveryFailureCacheDir?: string;
}

/**
 * Build a list of possible improved creatures based on discovery suggestions.
 *
 * This is the main coordinator function. It delegates to focused modules for
 * candidate creation, combination, scoring, and application.
 *
 * @param baseCreature The creature to apply discovery changes to
 * @param discovery The discovery result containing candidate changes
 * @param options Options controlling candidate building
 */
export function buildDiscoveryCandidates(
  baseCreature: Creature,
  discovery: DiscoverResult,
  options?: BuildDiscoveryCandidatesOptions,
): DiscoveryCandidate[] {
  const skipCombos = options?.skipCombinedCandidates ?? false;
  const discoveryFailureCacheDir = options?.discoveryFailureCacheDir;
  CreatureUtil.makeUUID(baseCreature);

  // Score-gain extractors — Rust v0.2.0+ returns creature-level values directly
  const getExpectedNeuron = (candidate: CandidateNeuron) =>
    candidate.expectedCreatureScoreGain;
  const getExpectedSynapse = (candidate: CandidateSynapse) =>
    candidate.expectedCreatureScoreGain;
  const getExpectedSquash = (candidate: CandidateSquash) =>
    candidate.expectedCreatureScoreGain;
  const getExpectedCoordinated = (
    candidate: CoordinatedStructuralCandidate,
  ) => candidate.expectedCreatureScoreGain;
  const getExpectedRemoval = (candidate?: CandidateSynapse) => {
    if (!candidate) return undefined;
    const value = candidate.expectedCreatureScoreGain;
    return value !== undefined ? Math.abs(value) : undefined;
  };

  const candidates: DiscoveryCandidate[] = [];

  const {
    addHelpfulSynapses,
    removeHarmfulSynapse,
    removeHarmfulNeurons,
    candidateSquashes,
  } = discovery;

  // --- Combined neurons (all at once) ---
  let addedNeuronCreature: Creature | undefined;
  const helpfulNeuronCandidates = discovery.addHelpfulNeurons;
  if (!skipCombos) {
    const neuronResult = buildCombinedNeuronCandidate(
      discovery.ID,
      baseCreature,
      helpfulNeuronCandidates,
      getExpectedNeuron,
      discoveryFailureCacheDir,
    );
    addedNeuronCreature = neuronResult.creature;
    if (neuronResult.candidate) {
      candidates.push(neuronResult.candidate);
    }
  }

  // --- Single neurons ---
  candidates.push(
    ...buildSingleNeuronCandidates(
      discovery.ID,
      baseCreature,
      helpfulNeuronCandidates,
      getExpectedNeuron,
      discoveryFailureCacheDir,
    ),
  );

  // --- Coordinated structural ---
  candidates.push(
    ...buildCoordinatedStructuralCandidates(
      discovery,
      baseCreature,
      getExpectedCoordinated,
    ),
  );

  // --- Combined synapses (all at once) ---
  let addedSynapseCreature: Creature | undefined;
  if (!skipCombos) {
    const synapseResult = buildCombinedSynapseCandidate(
      discovery.ID,
      baseCreature,
      addHelpfulSynapses,
      getExpectedSynapse,
      discoveryFailureCacheDir,
    );
    addedSynapseCreature = synapseResult.creature;
    if (synapseResult.candidate) {
      candidates.push(synapseResult.candidate);
    }
  }

  // --- Single synapses ---
  candidates.push(
    ...buildSingleSynapseCandidates(
      discovery.ID,
      baseCreature,
      addHelpfulSynapses,
      getExpectedSynapse,
      discoveryFailureCacheDir,
    ),
  );

  // --- Harmful synapse removal ---
  const synapseRemovalResult = buildHarmfulSynapseRemovalCandidates(
    discovery,
    baseCreature,
    removeHarmfulSynapse,
    addHelpfulSynapses,
    addedSynapseCreature,
    skipCombos,
    getExpectedRemoval,
    discoveryFailureCacheDir,
  );
  candidates.push(...synapseRemovalResult.candidates);

  // --- Combined squash changes ---
  let changedSquashCreature: Creature | undefined;
  if (!skipCombos) {
    const squashResult = buildCombinedSquashCandidates(
      discovery.ID,
      baseCreature,
      candidateSquashes,
      addHelpfulSynapses,
      addedSynapseCreature,
      getExpectedSquash,
      discoveryFailureCacheDir,
    );
    changedSquashCreature = squashResult.creature;
    candidates.push(...squashResult.candidates);
  }

  // --- Single squash changes ---
  candidates.push(
    ...buildSingleSquashCandidates(
      discovery.ID,
      baseCreature,
      candidateSquashes,
      getExpectedSquash,
      discoveryFailureCacheDir,
    ),
  );

  // --- Harmful neuron removal ---
  const harmfulNeuronCandidate = buildHarmfulNeuronRemovalCandidate(
    discovery.ID,
    baseCreature,
    removeHarmfulNeurons,
    discoveryFailureCacheDir,
  );
  if (harmfulNeuronCandidate) {
    candidates.push(harmfulNeuronCandidate);
  }

  // --- Low-impact removal candidates ---
  candidates.push(
    ...buildLowImpactRemovalCandidates(
      discovery,
      baseCreature,
      discoveryFailureCacheDir,
    ),
  );

  // --- Combined candidates ---
  if (!skipCombos) {
    const removedSynapseExists = candidates.some(
      (c) => c.change.type === "remove-synapse",
    );

    const combinedCandidate = buildCombinedCandidate({
      baseCreature,
      discoveryID: discovery.ID,
      selection: {
        addHelpfulNeurons: addedNeuronCreature
          ? helpfulNeuronCandidates
          : undefined,
        addHelpfulSynapses: addedSynapseCreature
          ? addHelpfulSynapses
          : undefined,
        removeHarmfulSynapse: removedSynapseExists
          ? removeHarmfulSynapse
          : undefined,
        removeHarmfulNeurons: harmfulNeuronCandidate
          ? removeHarmfulNeurons
          : undefined,
        candidateSquashes: changedSquashCreature
          ? candidateSquashes
          : undefined,
      },
      changeType: "combo-all",
      description: "🏗️ Combined all discovery changes",
      discoveryFailureCacheDir,
    });
    if (combinedCandidate) {
      candidates.push(combinedCandidate);
    }

    const bestOfCategoryCandidate = buildBestOfCategoryCandidate(
      baseCreature,
      discovery,
      {
        synapse: getExpectedSynapse,
        neuron: getExpectedNeuron,
        squash: getExpectedSquash,
      },
      discoveryFailureCacheDir,
    );
    if (bestOfCategoryCandidate) {
      if (discovery.removeHarmfulSynapse) {
        bestOfCategoryCandidate.creature = persistentlyRemoveHarmfulSynapse(
          bestOfCategoryCandidate.creature,
          discovery.removeHarmfulSynapse,
        );
      }
      candidates.push(bestOfCategoryCandidate);
    }
  }

  return candidates;
}
