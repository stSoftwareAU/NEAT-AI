import { assert } from "@std/assert";
import { removeTag } from "@stsoftware/tags/mod";
import { type Creature, CreatureUtil, Mutation } from "../../mod.ts";
import { discover } from "@blackbox/Discover.ts";
import { memeticUpdate } from "@blackbox/MemeticUpdate.ts";
import type { NeatConfig } from "@config/NeatConfig.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import { AddBackCon } from "@mutate/AddBackCon.ts";
import { AddConnection } from "@mutate/AddConnection.ts";
import { AddNeuron } from "@mutate/AddNeuron.ts";
import { AddSelfCon } from "@mutate/AddSelfCon.ts";
import { ModBias } from "@mutate/ModBias.ts";
import { ModActivation as ModSquash } from "@mutate/ModSquash.ts";
import { ModWeight } from "@mutate/ModWeight.ts";
import type { RadioactiveInterface } from "@mutate/RadioactiveInterface.ts";
import { computeMutationBias } from "@predictiveCoding/PredictionErrorGuidedMutation.ts";
import type { MutationBias } from "@predictiveCoding/PredictionErrorGuidedMutation.ts";
import { SubBackCon } from "@mutate/SubBackCon.ts";
import { SubConnection } from "@mutate/SubConnection.ts";
import { SubNeuron } from "@mutate/SubNeuron.ts";
import { SubSelfCon } from "@mutate/SubSelfCon.ts";
import { SwapNeurons } from "@mutate/SwapNeurons.ts";
import { getLogger } from "@utils/Logger.ts";
import { getRandomNumberGenerator } from "@utils/RandomNumberGenerator.ts";
import { DEFAULT_EVOLVABLE_HYPERPARAMETERS } from "@config/HyperparameterConfig.ts";
import {
  createDefaultHyperparameters,
  mutateHyperparameters,
} from "@neat/HyperparameterEvolution.ts";
import {
  computeCreatureWeightBiasPenalty,
  isTopologyMutation,
  metropolisHastingsAccept,
} from "@neat/MetropolisHastings.ts";
import type { MCMCDiagnostics } from "@neat/MCMCDiagnostics.ts";
import { SquashEffectivenessTracker } from "@neat/SquashEffectivenessTracker.ts";

/**
 * Cache entry for valid mutation candidates.
 * Stores both the filtered candidates and pre-computed weight/bias count.
 */
interface MutationCacheEntry {
  /** Filtered mutation methods that are valid for this creature state. */
  candidates: ReadonlyArray<{ name: string }>;
  /** Count of weight/bias mutations in candidates (for weighted selection). */
  weightBiasCount: number;
  /** Issue #2125: Pre-computed non-expansion candidates for large creature selection. */
  nonExpansionCandidates: ReadonlyArray<{ name: string }>;
}

export class Mutator {
  private config: NeatConfig;

  /**
   * Issue #2200: Current MCMC temperature for Metropolis-Hastings acceptance.
   * When undefined or when mcmc.enabled is false, all mutations are accepted
   * unconditionally (preserving existing behaviour).
   */
  private mcmcTemperature?: number;

  /**
   * Issue #2201: Optional diagnostics tracker for recording M-H acceptance decisions.
   */
  private mcmcDiagnostics?: MCMCDiagnostics;

  /**
   * Issue #2457: Per-role squash effectiveness tracker. Persists across
   * generations within a run so ModSquash can bias toward squashes that
   * historically improved fitness in similar roles. When omitted, the
   * Mutator constructs an internal tracker from `config.squashEffectiveness`
   * so single-population callers (e.g. `Neat.populatePopulation`) still
   * benefit.
   */
  private readonly squashTracker: SquashEffectivenessTracker;

  private isMutationTopologyForwardOnly(creature: Creature): boolean {
    return creature.forwardOnly === true;
  }

  /**
   * Cache for valid mutation candidates.
   * Key format: "neurons|synapses|input|output|forwardOnly"
   * Issue #1028: Avoid repeated filtering in selectMutationMethod().
   */
  private mutationCache: Map<string, MutationCacheEntry> = new Map();

  /**
   * Issue #1103: WeakMap-based cache for mutation operator instances per creature.
   * Issue #1396: Consolidated from 12 separate WeakMaps into a single cache.
   * Using WeakMap allows garbage collection of unused creatures while caching
   * their mutation instances. This reduces object allocations during evolution.
   */
  private operatorCache = new WeakMap<
    Creature,
    Map<string, RadioactiveInterface>
  >();

  /**
   * @param config - The NEAT configuration
   * @param mcmcTemperature - Issue #2200: Optional current temperature for M-H acceptance
   * @param mcmcDiagnostics - Issue #2201: Optional diagnostics for recording M-H decisions
   * @param squashTracker - Issue #2457: Optional shared per-role squash
   *   effectiveness tracker. When omitted, an internal tracker is created
   *   from `config.squashEffectiveness`.
   */
  constructor(
    config: NeatConfig,
    mcmcTemperature?: number,
    mcmcDiagnostics?: MCMCDiagnostics,
    squashTracker?: SquashEffectivenessTracker,
  ) {
    this.config = config;
    this.mcmcTemperature = mcmcTemperature;
    this.mcmcDiagnostics = mcmcDiagnostics;
    this.squashTracker = squashTracker ??
      new SquashEffectivenessTracker(config.squashEffectiveness);
  }

  /**
   * Issue #2457: Expose the tracker so the evolution loop can commit
   * pending entries after fitness re-evaluation.
   */
  public getSquashEffectivenessTracker(): SquashEffectivenessTracker {
    return this.squashTracker;
  }

  /**
   * Clears the mutation candidates cache.
   * Call this if the config changes (though config is typically immutable).
   */
  public clearMutationCache(): void {
    this.mutationCache.clear();
  }

  /**
   * Issue #1103: Gets a cached mutator instance for a creature and mutation type.
   * Issue #1396: Consolidated from 12 separate switch cases into a single
   * cache lookup with a factory method.
   *
   * @param creature - The creature to get a mutator for.
   * @param methodName - The name of the mutation method.
   * @returns The cached (or newly created) mutator instance.
   */
  public getMutatorInstance(
    creature: Creature,
    methodName: string,
  ): RadioactiveInterface {
    let creatureOps = this.operatorCache.get(creature);
    if (!creatureOps) {
      creatureOps = new Map();
      this.operatorCache.set(creature, creatureOps);
    }

    let instance = creatureOps.get(methodName);
    if (!instance) {
      instance = this.createOperator(creature, methodName);
      creatureOps.set(methodName, instance);
    }
    return instance;
  }

  /**
   * Issue #2220: Static factory map replacing the switch statement in createOperator().
   * Maps mutation method names to factory functions that instantiate the correct operator.
   * This follows the Open/Closed Principle — adding a new mutation type only requires
   * a new map entry, not modifying a switch statement.
   */
  private static readonly operatorFactories = new Map<
    string,
    (creature: Creature, config: NeatConfig) => RadioactiveInterface
  >([
    [Mutation.ADD_NODE.name, (c, _cfg) => new AddNeuron(c)],
    [Mutation.SUB_NODE.name, (c, _cfg) => new SubNeuron(c)],
    [Mutation.ADD_CONN.name, (c, _cfg) => new AddConnection(c)],
    [Mutation.SUB_CONN.name, (c, _cfg) => new SubConnection(c)],
    // Issue #1309: Pass weight regularisation config to ModWeight
    [
      Mutation.MOD_WEIGHT.name,
      (c, cfg) => new ModWeight(c, cfg.weightRegularisation),
    ],
    // Issue #1416: Pass bias regularisation config to ModBias
    [
      Mutation.MOD_BIAS.name,
      (c, cfg) => new ModBias(c, cfg.biasRegularisation),
    ],
    // Issue #2457: ModSquash receives the per-role tracker via createOperator.
    [Mutation.MOD_SQUASH.name, (c, _cfg) => new ModSquash(c)],
    [Mutation.ADD_SELF_CONN.name, (c, _cfg) => new AddSelfCon(c)],
    [Mutation.SUB_SELF_CONN.name, (c, _cfg) => new SubSelfCon(c)],
    [Mutation.ADD_BACK_CONN.name, (c, _cfg) => new AddBackCon(c)],
    [Mutation.SUB_BACK_CONN.name, (c, _cfg) => new SubBackCon(c)],
    [Mutation.SWAP_NODES.name, (c, _cfg) => new SwapNeurons(c)],
  ]);

  /**
   * Issue #2220: Factory method that creates the correct mutation operator
   * for a given method name using the static factory map.
   */
  private createOperator(
    creature: Creature,
    methodName: string,
  ): RadioactiveInterface {
    // Issue #2457: ModSquash needs the per-role effectiveness tracker, which
    // is held on the Mutator instance and therefore cannot live on the
    // static factory map.
    if (methodName === Mutation.MOD_SQUASH.name) {
      return new ModSquash(creature, this.squashTracker);
    }
    const factory = Mutator.operatorFactories.get(methodName);
    if (!factory) {
      throw new ValidationError(
        `Unknown mutation method: ${methodName}`,
        "OTHER",
      );
    }
    return factory(creature, this.config);
  }

  /**
   * Mutates the given (or current) population
   */
  mutate(creatures: Creature[]): void {
    const rng = getRandomNumberGenerator();
    const mcmcEnabled = this.config.mcmc.enabled &&
      this.mcmcTemperature !== undefined;

    for (let i = creatures.length; i--;) {
      if (rng.random() <= this.config.mutationRate) {
        const creature = creatures[i];
        let original: Creature | undefined;
        if (creature.score !== undefined || creature.memetic) {
          // Issue #1586: Use shallowClone() instead of JSON serialisation
          // for a 2-3x performance improvement during evolution.
          original = creature.shallowClone();
        }

        // Issue #2200: MCMC snapshot — needed even when there's no
        // score/memetic, so we can revert on M-H rejection.
        let mcmcSnapshot: Creature | undefined;
        let preMutationPenalty: number | undefined;
        if (mcmcEnabled) {
          mcmcSnapshot = original ?? creature.shallowClone();
          preMutationPenalty = computeCreatureWeightBiasPenalty(creature);
        }

        let changed = false;

        // Issue #2200: Track whether any topology mutations were applied.
        // Topology mutations are always accepted; M-H only applies to
        // weight/bias-only mutation batches.
        let hasTopologyMutation = false;

        // Issue #1100: Track focus list across mutations to preserve focus cache.
        // Only clear focus cache when the focus list changes between mutations.
        let lastFocusList: number[] | undefined;

        // Issue #1557: Compute prediction-error-guided mutation bias when
        // Predictive Coding is enabled. The bias is computed once per creature
        // and reused across all mutation rounds for that creature.
        const mutationBias = this.config.predictiveCoding.enabled
          ? computeMutationBias(creature)
          : undefined;

        for (let j = this.config.mutationAmount; j--;) {
          const mutationMethod = this.selectMutationMethod(creature);

          const currentFocusList = rng.random() < this.config.focusRate
            ? this.config.focusList
            : undefined;

          // Issue #1100: Clear focus cache only when focus list changes.
          // This preserves focus cache across mutations with constant focus list,
          // avoiding expensive recalculation of focus status.
          if (!this.arrayEquals(currentFocusList, lastFocusList)) {
            creature.clearFocusCache();
            lastFocusList = currentFocusList;
          }

          const flag = this.mutateCreature(
            creature,
            mutationMethod,
            currentFocusList,
            mutationBias,
          );
          if (flag) {
            changed = true;
            // Issue #2200: Track topology mutations for M-H gating
            if (isTopologyMutation(mutationMethod.name)) {
              hasTopologyMutation = true;
            }
          }
        }

        // Issue #1583: Run fix() once after the entire mutation loop rather than
        // per-mutation. Mutations must keep the creature valid; we do not run full
        // structural validation on every batch (use Creature.DEBUG / validate() when
        // diagnosing bugs).
        if (changed) {
          this.repairAfterMutation(creature);
        }

        // Issue #2200: Metropolis-Hastings acceptance criterion.
        // For weight/bias-only mutations, compare pre/post penalty and
        // probabilistically accept or reject. Topology mutations are always
        // accepted since they are discrete structural changes.
        if (
          changed && mcmcEnabled && mcmcSnapshot &&
          preMutationPenalty !== undefined && !hasTopologyMutation
        ) {
          const postMutationPenalty = computeCreatureWeightBiasPenalty(
            creature,
          );
          const deltaCost = postMutationPenalty - preMutationPenalty;

          const accepted = metropolisHastingsAccept(
            deltaCost,
            this.mcmcTemperature!,
            rng.random(),
          );

          // Issue #2201: Record the M-H decision for diagnostics
          this.mcmcDiagnostics?.recordDecision(accepted);

          if (!accepted) {
            // Rejected: revert creature to pre-mutation snapshot
            this.revertCreature(creature, mcmcSnapshot);
            changed = false;

            if (this.config.verbose) {
              getLogger().info(
                `[MCMC] Mutation rejected (δ=${deltaCost.toFixed(6)}, T=${
                  this.mcmcTemperature!.toFixed(6)
                })`,
              );
            }
          }
        }

        // Issue #1097: Prebuild inward index for large creatures after mutation batch.
        // This optimises subsequent inward connection lookups by avoiding
        // linear scans before the lazy index build threshold is reached.
        creature.prebuildInwardIndexIfLarge();

        if (changed) {
          removeTag(creature, "approach");
          removeTag(creature, "approach-logged");
          removeTag(creature, "trainID");
          removeTag(creature, "trained");

          // Issue #1863: Mutate per-creature hyperparameters when enabled
          if (this.config.hyperparameterEvolution.enabled) {
            const currentParams = creature.hyperparameters
              ? {
                ...DEFAULT_EVOLVABLE_HYPERPARAMETERS,
                ...creature.hyperparameters,
              }
              : createDefaultHyperparameters(
                this.config.hyperparameterEvolution,
              );
            creature.hyperparameters = mutateHyperparameters(
              currentParams,
              this.config.hyperparameterEvolution,
            );
          }

          creature.clearState();
          delete creature.memetic;
          delete creature.uuid;
          creature.state.preparedNeurons = false;
          if (original) {
            // Issue #2322: Only call memeticUpdate when original has a memetic.
            // shallowClone() (Issue #2308) copies score onto the clone, which
            // causes `original` to be set even when there is no memetic. Calling
            // memeticUpdate with an undefined memetic violates its precondition
            // (assert(parent.memetic)) and throws an AssertionError.
            const memetic = original.memetic
              ? memeticUpdate(original, creature)
              : undefined;
            if (memetic) {
              creature.memetic = memetic;
            } else {
              discover(original, creature);
            }
          }
        }
      }
    }
  }

  /**
   * Issue #2200: Reverts a creature to its pre-mutation snapshot state.
   * Restores neurons, synapses, and key properties from the original.
   */
  private revertCreature(creature: Creature, original: Creature): void {
    // Restore neurons array
    creature.neurons.length = 0;
    for (const neuron of original.neurons) {
      creature.neurons.push(neuron);
    }

    // Restore synapses array
    creature.synapses.length = 0;
    for (const synapse of original.synapses) {
      creature.synapses.push(synapse);
    }

    // Restore key properties
    creature.score = original.score;
    creature.memetic = original.memetic;
    creature.uuid = original.uuid;
    creature.forwardOnly = original.forwardOnly;
    creature.hyperparameters = original.hyperparameters;

    creature.clearState();
    creature.state.preparedNeurons = false;
  }

  /**
   * Calculate the theoretical maximum number of synapses for a given number of neurons,
   * considering that observation neurons do not connect to each other.
   * @param observations - Number of observation (input) neurons.
   * @param hidden - Number of hidden neurons.
   * @param outputs - Number of output neurons.
   * @returns The maximum number of synapses.
   */
  calculateMaxSynapses(
    observations: number,
    hidden: number,
    outputs: number,
  ): number {
    // Observations to hidden connections
    const obsToHidden = observations * hidden;

    // Observations to outputs connections
    const obsToOutputs = observations * outputs;

    // Hidden to hidden connections (no cycles)
    const hiddenToHidden = (hidden * (hidden - 1)) / 2;

    // Hidden to outputs connections
    const hiddenToOutputs = hidden * outputs;

    // Total possible synapses
    return obsToHidden + obsToOutputs + hiddenToHidden + hiddenToOutputs;
  }

  /**
   * Generates a cache key for mutation candidates based on creature state.
   * Issue #1028: Cache valid mutations between selection calls.
   */
  private getMutationCacheKey(
    creature: Creature,
    forwardOnly: boolean,
  ): string {
    return `${creature.neurons.length}|${creature.synapses.length}|${creature.input}|${creature.output}|${forwardOnly}`;
  }

  /**
   * Computes the filtered mutation candidates and weight/bias count.
   * Issue #1028: Separated from selectMutationMethod for caching.
   */
  private computeMutationCandidates(
    creature: Creature,
    forwardOnly: boolean,
  ): MutationCacheEntry {
    const mutationMethods = this.config.mutation;
    const feedbackLoop = this.config.feedbackLoop;

    // Pre-compute max synapses once for ADD_CONN check
    const maxSynapses = this.calculateMaxSynapses(
      creature.input,
      creature.neurons.length - creature.input - creature.output,
      creature.output,
    );

    // Avoid infinite loops: pre-filter for methods that can actually run under
    // the current constraints.
    const candidates = mutationMethods.filter((method) => {
      switch (method.name) {
        case Mutation.ADD_NODE.name:
          return creature.neurons.length < this.config.maximumNumberOfNodes;
        case Mutation.ADD_CONN.name:
          return !(
            creature.synapses.length >= this.config.maxConns ||
            creature.synapses.length >= maxSynapses
          );
        case Mutation.SUB_NODE.name:
          return creature.neurons.length > creature.input + creature.output;
        case Mutation.SWAP_NODES.name:
          return creature.neurons.length > creature.input + creature.output + 1;
        case Mutation.ADD_BACK_CONN.name:
        case Mutation.SUB_BACK_CONN.name:
        case Mutation.ADD_SELF_CONN.name:
        case Mutation.SUB_SELF_CONN.name:
          // Self/back connections are only valid in feedback/memory mode and never
          // for semanticVersion 4.x forward-only creatures.
          return feedbackLoop !== false && forwardOnly === false;
        default:
          return true;
      }
    });

    // Pre-compute weight/bias count for weighted selection (Issue #1009)
    let weightBiasCount = 0;
    for (const candidate of candidates) {
      if (
        candidate.name === Mutation.MOD_BIAS.name ||
        candidate.name === Mutation.MOD_WEIGHT.name
      ) {
        weightBiasCount++;
      }
    }

    // Issue #2125: Pre-compute non-expansion candidates once per cache key.
    // This avoids repeated .filter() calls in selectMutationMethod() for large
    // creatures, reducing per-call array allocations and GC pressure.
    const nonExpansionCandidates = candidates.filter((c) =>
      !this.isTopologyExpansionMutation(c.name)
    );

    return { candidates, weightBiasCount, nonExpansionCandidates };
  }

  /**
   * Determines if a mutation is a topology expansion mutation.
   * These mutations increase structural complexity (ADD_NODE, ADD_CONN).
   */
  private isTopologyExpansionMutation(name: string): boolean {
    return name === Mutation.ADD_NODE.name || name === Mutation.ADD_CONN.name;
  }

  /**
   * Compare two focus lists for equality.
   *
   * Issue #1100: Used to determine if focus cache should be cleared.
   * Returns true if both arrays contain the same elements in the same order,
   * or if both are undefined/empty.
   *
   * @param a - First focus list (or undefined)
   * @param b - Second focus list (or undefined)
   * @returns true if the lists are equal
   */
  private arrayEquals(
    a: number[] | undefined,
    b: number[] | undefined,
  ): boolean {
    // Both undefined or empty - equal
    if (!a || a.length === 0) {
      return !b || b.length === 0;
    }
    if (!b || b.length === 0) {
      return false;
    }
    // Different lengths - not equal
    if (a.length !== b.length) {
      return false;
    }
    // Compare elements
    for (let i = 0; i < a.length; i++) {
      if (a[i] !== b[i]) {
        return false;
      }
    }
    return true;
  }

  /**
   * Selects a random mutation method for a genome according to the parameters.
   * Issue #1028: Uses caching to avoid repeated filtering.
   * Issue #1037: Implements adaptive mutation rate based on creature size.
   */
  public selectMutationMethod(creature: Creature) {
    const forwardOnly = this.isMutationTopologyForwardOnly(creature);

    // Check cache for pre-filtered candidates (Issue #1028)
    const cacheKey = this.getMutationCacheKey(creature, forwardOnly);
    let cacheEntry = this.mutationCache.get(cacheKey);

    if (!cacheEntry) {
      // Cache miss: compute and store candidates
      cacheEntry = this.computeMutationCandidates(creature, forwardOnly);
      this.mutationCache.set(cacheKey, cacheEntry);
    }

    const { candidates, weightBiasCount } = cacheEntry;

    if (candidates.length === 0) {
      throw new ValidationError(
        `No valid mutation methods available for creature (semanticVersion=${creature.semanticVersion}, forwardOnly=${forwardOnly}) ` +
          `with config.feedbackLoop=${this.config.feedbackLoop}.`,
        "OTHER",
      );
    }

    // Issue #1037: Adaptive mutation rate based on creature size.
    // Large creatures benefit more from weight/bias tuning than topology expansion.
    const neuronCount = creature.neurons.length;
    const thresholds = this.config.adaptiveMutationThresholds;
    const { medium, large, largeTopologyWeight } = thresholds;

    // Determine weight/bias preference based on creature size
    let weightBiasPreference: number;
    if (neuronCount >= large) {
      // Large creatures: heavily favour weight/bias mutations
      // Only allow topology expansion with probability largeTopologyWeight
      weightBiasPreference = 1.0 - largeTopologyWeight;
    } else if (neuronCount >= medium) {
      // Medium creatures: interpolate between standard (0.75) and large preference
      // Linear interpolation from medium threshold to large threshold
      const t = (neuronCount - medium) / (large - medium);
      const standardPreference = 0.75;
      const largePreference = 1.0 - largeTopologyWeight;
      weightBiasPreference = standardPreference +
        t * (largePreference - standardPreference);
    } else {
      // Small creatures: use standard 75% weight/bias preference
      weightBiasPreference = 0.75;
    }

    // Optimized weighted selection (Issue #1009).
    // Prefer weight/bias mutations based on creature size for faster convergence.
    // This replaces the rejection sampling loop that could iterate up to 10,000 times.
    const rng = getRandomNumberGenerator();
    if (rng.random() < weightBiasPreference && weightBiasCount > 0) {
      // Select uniformly from weight/bias mutations
      const targetIndex = Math.floor(rng.random() * weightBiasCount);
      let found = 0;
      for (let i = 0; i < candidates.length; i++) {
        const name = candidates[i].name;
        if (
          name === Mutation.MOD_BIAS.name ||
          name === Mutation.MOD_WEIGHT.name
        ) {
          if (found === targetIndex) {
            return candidates[i];
          }
          found++;
        }
      }
    }

    // For large creatures, further filter to exclude topology expansion mutations
    // unless we explicitly pass the topology weight check above.
    // Issue #2125: Use pre-computed nonExpansionCandidates from cache instead of
    // filtering on every call.
    if (neuronCount >= large && largeTopologyWeight < 1.0) {
      const { nonExpansionCandidates } = cacheEntry;
      if (nonExpansionCandidates.length > 0) {
        return nonExpansionCandidates[
          Math.floor(rng.random() * nonExpansionCandidates.length)
        ];
      }
    }

    // Fallback: select uniformly from all candidates
    return candidates[Math.floor(rng.random() * candidates.length)];
  }

  /**
   * Repair a creature after mutation by running fix() and forward-only
   * validation. Call this once after applying one or more mutations via
   * mutateCreature().
   *
   * Issue #1583: Extracted from mutateCreature() so that fix() can be batched —
   * called once after the entire mutation loop rather than after every individual
   * mutation. Structural validation is not run here; mutations must preserve a
   * valid creature.
   */
  public repairAfterMutation(creature: Creature): void {
    const enforceForwardOnly = creature.forwardOnly === true ||
      (this.config.feedbackLoop !== true && creature.forwardOnly !== false);

    if (enforceForwardOnly) {
      creature.fix({ forwardOnly: true });
      creature.forwardOnly = true;
    } else {
      creature.fix();
    }
  }

  /**
   * Mutate the creature using a specific method.
   *
   * Issue #1583: No longer calls fix() internally. Callers must call
   * repairAfterMutation() after one or more mutations to normalise topology.
   *
   * @param {Object} method - The mutation method.
   * @param {string} method.name - The name of the mutation method.
   * @param {number[]} [focusList] - The list of focus indices.
   * @param {MutationBias} [mutationBias] - Issue #1557: Optional bias to
   *   guide structural mutations.
   * @returns {boolean} true if the creature was changed by this mutation.
   */
  public mutateCreature(
    creature: Creature,
    method: { name: string },
    focusList?: number[],
    mutationBias?: MutationBias,
  ): boolean {
    assert(method.name, "Mutate name is required");
    const startUUID = CreatureUtil.makeUUID(creature);

    // Issue #1103: Use cached mutator instances via getMutatorInstance().
    // This avoids recreating mutation class instances for each mutation call,
    // significantly reducing object allocations during evolution.
    const mutator = this.getMutatorInstance(creature, method.name);

    const changed = mutator.mutate(focusList, mutationBias);

    // Issue #2383: Demote the "didn't mutate" diagnostic. An unfocused
    // mutation that cannot produce a change (e.g. every draw is clamped at
    // the boundary for ModWeight) is not a warning-worthy event — it is a
    // best-effort operator returning false. Only surface it when the
    // creature is being debugged.
    if (!changed && (!focusList || focusList.length === 0) && creature.DEBUG) {
      getLogger().debug(
        `${method.name} didn't mutate the creature. ${creature.input} observations, ${
          creature.neurons.length - creature.input - creature.output
        } neurons, ${creature.output} outputs, ${creature.synapses.length} synapses`,
      );
    }

    if (changed) {
      delete creature.uuid;
      creature.state.preparedNeurons = false;
    }

    const endUUID = CreatureUtil.makeUUID(creature);
    if (startUUID === endUUID) {
      // Issue #2383: Only warn when the operator claimed a change but the
      // UUID did not rotate — that indicates a real bug (a mutation that
      // altered state without invalidating the UUID cache). When the
      // operator returned false the UUID is expected to be stable, so no
      // diagnostic is needed.
      if (changed) {
        getLogger().warn(
          `UUID didn't change after ${method.name} mutation despite operator reporting a change`,
        );
      }
      return false;
    } else {
      return true;
    }
  }
}
