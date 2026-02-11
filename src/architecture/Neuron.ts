import { assert } from "@std/assert";
import { addTags, removeTag, type TagsInterface } from "@stsoftware/tags/mod";
import type { Creature } from "../Creature.ts";
import type { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Activations } from "../methods/activations/Activations.ts";
import type { ApplyLearningsInterface } from "../methods/activations/ApplyLearningsInterface.ts";
import type { NeuronActivationInterface } from "../methods/activations/NeuronActivationInterface.ts";
import type { NeuronFixableInterface } from "../methods/activations/NeuronFixableInterface.ts";
import type {
  UnSquashInterface,
} from "../methods/activations/UnSquashInterface.ts";
import { Mutation } from "../NEAT/Mutation.ts";
import {
  findActivationFunction,
  type FunctionCache,
} from "../optimize/FunctionCache.ts";
import type { MakeActivationFunctionInterface } from "../optimize/MakeActivationFunctionInterface.ts";
import {
  type BackPropagationConfig,
  toValue,
} from "../propagate/BackPropagation.ts";
// Issue #1143 - WASM backpropagation integration
// Issue #1377 - Fused backward pass error distribution in WASM
import {
  calculateError as wasmCalculateError,
  fusedErrorDistribution,
  squash as wasmSquash,
} from "../wasm/ActivationMethods.ts";
import { getSquashType, SquashType } from "../wasm/SquashType.ts";
import {
  accumulateBias,
  adjustedBias,
  calculateBias,
} from "../propagate/Bias.ts";
import { distributeElasticError } from "../propagate/ElasticDistribution.ts";
import {
  buildRecordElasticLinks,
  constrainAndRedistributeRecordShares,
  distributeRecordError,
} from "../propagate/RecordElasticity.ts";
import type { SparseConfig } from "../propagate/sparse/SparseConfig.ts";
import {
  accumulateWeight,
  adjustedWeight,
  calculateWeight,
} from "../propagate/Weight.ts";
import type { DiscoverRecord } from "./ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import type { NeuronExport, NeuronInternal } from "./NeuronInterfaces.ts";
import { noChangePropagate } from "./NoChangePropagate.ts";
import { Synapse } from "./Synapse.ts";

/**
 * Represents a neuron in a neural network.
 *
 * A neuron is a computational unit that receives inputs, applies an activation function,
 * and produces an output. Neurons can be of different types (input, hidden, output, constant)
 * and can have various activation functions applied to them.
 *
 * Key features:
 * - Supports different neuron types (input, hidden, output, constant)
 * - Configurable activation functions
 * - Bias values for fine-tuning
 * - UUID-based identification
 * - Tagging system for metadata
 *
 * @example
 * ```ts
 * const neuron = new Neuron("hidden-1", "hidden", 0.5, creature, "TANH");
 * neuron.activateNeuron();
 * ```
 */
export class Neuron implements TagsInterface, NeuronInternal {
  /** Reference to the parent creature */
  readonly creature: Creature;
  /** Type of the neuron (input, output, hidden, or constant) */
  type: "input" | "output" | "hidden" | "constant";
  /** Unique identifier for the neuron */
  uuid: string;
  /** Bias value added to the neuron's input */
  bias: number;
  /** Name of the activation function to apply */
  squash?: string;
  /** Cached activation function instance for performance */
  private squashMethodCache?:
    | NeuronActivationInterface
    | ActivationInterface;

  /**
   * Cached complexity penalty for score calculation.
   * Issue #1043: Cache Activations.find() lookups in score calculation.
   * Invalidated when squash function changes via setSquash().
   */
  private complexityPenaltyCache?: number;

  /**
   * Cached SquashType enum value for this neuron's squash function.
   * Issue #1378: Pre-compute squash type indices to avoid repeated
   * getSquashType() string-to-enum lookups during backpropagation.
   * Invalidated when squash function changes via setSquash().
   */
  private squashTypeCache?: number;

  /** Index position of the neuron in the creature's neuron array */
  public index: number;
  /** Tags for storing metadata about the neuron */
  public tags = undefined;

  /**
   * Creates a new neuron instance.
   *
   * @param uuid - Unique identifier for the neuron
   * @param type - Type of neuron (input, output, hidden, or constant)
   * @param bias - Bias value for the neuron
   * @param creature - Reference to the parent creature
   * @param squash - Optional activation function name
   */
  constructor(
    uuid: string,
    type: "input" | "output" | "hidden" | "constant",
    bias: number,
    creature: Creature,
    squash?: string,
  ) {
    this.uuid = uuid;
    this.type = type;

    if (type !== "input") {
      if (type !== "output" && type !== "hidden" && type !== "constant") {
        throw new Error("invalid type: " + type);
      }

      this.bias = bias;

      if (type === "constant") {
        if (squash) {
          throw new Error(
            "constants should not have a squash was: " + squash,
          );
        }
      } else {
        if (squash) {
          this.squash = squash;
        } else {
          this.squash = Activations.pickRandomSquash();
        }
      }
    } else {
      this.bias = Infinity;
    }

    this.creature = creature;

    this.index = -1;
  }

  public validate() {
    if (this.type === "output" || this.type === "hidden") {
      if (!this.squash) {
        throw new Error(`Missing squash for ${this.type} neuron`);
      }
    } else {
      if (this.squash) {
        throw new Error(`Unexpected squash for ${this.type} neuron`);
      }

      if (this.squashMethodCache) {
        throw new Error(`Unexpected squashMethodCache for ${this.type} neuron`);
      }
    }
  }

  private functionCache: FunctionCache = { key: "" };

  /**
   * Creates a function that calculates the activation of the neuron
   * @returns A function that calculates the activation of the neuron
   */
  private makeFunction(): () => {
    activation: number;
    value: number;
  } {
    let functionBody = "const activations = state.activations;\n";
    functionBody += `const value = ${this.bias}`;

    const inwardList = this.creature.inwardConnections(this.index);
    const inwardListClone = inwardList.slice(0).sort((a, b) => a.from - b.from);
    for (let i = 0, len = inwardListClone.length; i < len; i++) {
      const { from, weight } = inwardListClone[i];
      functionBody += `+\nactivations[${from}] * ${weight}`;
    }
    functionBody += `;\n`;

    functionBody += `const activation = squash(value);\n`;
    functionBody += `activations[${this.index}] = activation;\n`;
    functionBody += "return { activation, value };";

    const foundFunction = findActivationFunction(
      functionBody,
      this.functionCache,
      this.squash,
    );

    if (foundFunction) {
      return foundFunction;
    }

    // Dynamically create the function
    const func = new Function(
      "state", // Parameter: neuron state
      "squash", // Parameter: squash function
      functionBody,
    ) as (
      state: { activations: Float32Array },
      squash: (value: number) => number,
    ) => {
      activation: number;
      value: number;
    };

    // Bind static parameters: state and squash function
    const bondedFunction = func.bind(
      null,
      this.creature.state,
      this.squashProxy,
    );

    this.functionCache.function = bondedFunction;
    return bondedFunction;
  }

  /**
   * Updates the cached activation function based on neuron type and squash.
   */
  public prepare():
    | undefined
    | NeuronActivationInterface
    | ActivationInterface
    | UnSquashInterface {
    if (this.type === "constant") {
      this.activateAndTraceNeuron = this.activateConstant;
      this.activateNeuron = this.activateConstant;
    } else if (this.squash) {
      const squashMethod = this.findSquash();
      if (this.isNodeActivation(squashMethod)) {
        this.activateAndTraceNeuron = this.activateAndTraceNeuronActivation;

        if (
          (squashMethod as MakeActivationFunctionInterface)
            .makeActivationFunction
        ) {
          this.activateNeuron =
            (squashMethod as MakeActivationFunctionInterface)
              .makeActivationFunction(this, this.functionCache);
        } else {
          this.activateNeuron = this.activateNeuronActivation;
        }
        this.activateProxy = squashMethod.activate.bind(squashMethod);
        this.activateAndTraceProxy = squashMethod.activateAndTrace.bind(
          squashMethod,
        );
      } else {
        this.activateAndTraceNeuron = this.activateAndTraceLinear;

        const squashActivation = squashMethod as ActivationInterface;
        this.squashProxy = squashActivation.squash.bind(squashActivation);

        this.activateNeuron = this.makeFunction();
      }
      return squashMethod;
    }
  }

  ID(): string {
    return this.uuid.substring(Math.max(0, this.uuid.length - 8));
  }

  setSquash(
    name?: string,
  ): void {
    if (name !== this.squash) {
      delete this.squashMethodCache;
      delete this.complexityPenaltyCache;
      delete this.squashTypeCache;
      this.squash = name;
      // Invalidate creature's score cache since complexity penalty may have changed
      // Issue #1043: Cache Activations.find() lookups in score calculation
      this.creature.invalidateScoreCache();
    }
  }

  /**
   * Gets the complexity penalty for this neuron's activation function.
   * The value is cached for performance to avoid repeated Activations.find() calls.
   * Issue #1043: Cache Activations.find() lookups in score calculation.
   *
   * @returns The complexity penalty (0 for input/constant neurons or neurons without a penalty)
   */
  getComplexityPenalty(): number {
    // Input and constant neurons have no squash function, so no penalty
    if (this.type === "input" || this.type === "constant") {
      return 0;
    }

    // Return cached value if available
    if (this.complexityPenaltyCache !== undefined) {
      return this.complexityPenaltyCache;
    }

    // Compute and cache the penalty
    if (this.squash) {
      const squashFunction = this.findSquash();
      this.complexityPenaltyCache = squashFunction.complexityPenalty ?? 0;
    } else {
      this.complexityPenaltyCache = 0;
    }

    return this.complexityPenaltyCache;
  }

  /**
   * Returns the pre-computed SquashType enum value for this neuron.
   * Issue #1378: Avoids repeated getSquashType() string-to-enum lookups
   * during backpropagation. The cache is invalidated when the squash
   * function changes via setSquash().
   */
  cachedSquashType(): number {
    if (this.squashTypeCache !== undefined) {
      return this.squashTypeCache;
    }
    this.squashTypeCache = getSquashType(this.squash);
    return this.squashTypeCache;
  }

  findSquash():
    | NeuronActivationInterface
    | ActivationInterface
    | UnSquashInterface {
    if (!this.squashMethodCache) {
      this.squashMethodCache = Activations.find(
        this.squash!,
      ) as NeuronActivationInterface | ActivationInterface;
      this.squash = this.squashMethodCache.getName(); /* Handle aliases */
    }

    return this.squashMethodCache;
  }

  fix() {
    delete this.squashMethodCache;
    delete this.squashTypeCache;

    if (this.squash !== "IF") {
      const toList = this.creature.inwardConnections(this.index);
      toList.forEach((c) => {
        delete c.type;
      });
    }

    if (this.type === "hidden") {
      this.ensureHiddenOutwardConnection(true);
      const toList = this.creature.inwardConnections(this.index);
      if (toList.length === 0) {
        // Try all possible sources in random order
        const possibleSources: number[] = [];
        for (let fromIndx = 0; fromIndx < this.index; fromIndx++) {
          // Check if connection doesn't already exist
          if (!this.creature.getSynapse(fromIndx, this.index)) {
            possibleSources.push(fromIndx);
          }
        }

        if (possibleSources.length > 0) {
          // Pick a random valid source
          const fromIndx =
            possibleSources[Math.floor(Math.random() * possibleSources.length)];
          this.creature.connect(
            fromIndx,
            this.index,
            Synapse.randomWeight(),
          );
        }
      }
    } else if (this.type === "output") {
      const toList = this.creature.inwardConnections(this.index);
      if (toList.length === 0) {
        const fromIndx = Math.floor(
          Math.random() *
            (this.creature.nodeCount() - this.creature.outputCount()),
        );
        this.creature.connect(
          fromIndx,
          this.index,
          Synapse.randomWeight(),
        );
      }
    }

    if (this.squash) {
      const squashFunction = this.findSquash();

      if (this.isFixableActivation(squashFunction)) {
        squashFunction.fix(this);
      }
    }

    if (
      this.type === "hidden" &&
      this.creature.outwardConnections(this.index).length === 0
    ) {
      this.ensureHiddenOutwardConnection(false);
    }
  }

  private ensureHiddenOutwardConnection(allowSelfTargets: boolean): boolean {
    if (this.creature.outwardConnections(this.index).length > 0) {
      return true;
    }

    // Forward-only safety: never create a self-loop as a "last resort" outward
    // connection when the creature is explicitly marked as forward-only.
    //
    // Rationale:self-loops are valid in recurrent/memory
    // mode, but they must not be introduced during `fix()` for forward-only
    // creatures.
    const isForwardOnly = this.creature.forwardOnly === true;

    const candidates: number[] = [];
    const nodeCount = this.creature.nodeCount();

    for (let targetIdx = this.index + 1; targetIdx < nodeCount; targetIdx++) {
      const candidate = this.creature.neurons[targetIdx];
      if (!candidate || candidate.type === "constant") {
        continue;
      }
      if (!this.creature.getSynapse(this.index, candidate.index)) {
        candidates.push(candidate.index);
      }
    }

    // Only consider a self-loop as a true "last resort".
    //
    // This avoids introducing self connections into otherwise feed-forward
    // creatures (which can later be marked `forwardOnly=true` and validated).
    if (
      allowSelfTargets &&
      isForwardOnly === false &&
      candidates.length === 0 &&
      !this.creature.getSynapse(this.index, this.index)
    ) {
      candidates.push(this.index);
    }

    if (candidates.length === 0) {
      if (!allowSelfTargets) {
        return this.ensureHiddenOutwardConnection(true);
      }
      return false;
    }

    const targetIndex =
      candidates[Math.floor(Math.random() * candidates.length)];
    this.creature.connect(
      this.index,
      targetIndex,
      Synapse.randomWeight(),
    );

    return true;
  }

  private isNodeActivation(
    activation:
      | NeuronActivationInterface
      | ActivationInterface
      | UnSquashInterface,
  ): activation is NeuronActivationInterface {
    return (activation as NeuronActivationInterface).activateAndTrace !==
      undefined;
  }

  private hasApplyLearnings(
    activation:
      | ApplyLearningsInterface
      | NeuronActivationInterface
      | ActivationInterface
      | UnSquashInterface,
  ): activation is ApplyLearningsInterface {
    return (activation as ApplyLearningsInterface).applyLearnings !== undefined;
  }

  private isFixableActivation(
    activation:
      | NeuronActivationInterface
      | ActivationInterface
      | NeuronFixableInterface
      | UnSquashInterface,
  ): activation is NeuronFixableInterface {
    return (activation as NeuronFixableInterface).fix !== undefined;
  }

  private activateConstant(): { activation: number; value: number } {
    const state = this.creature.state;
    const activations = state.activations;
    const activation = this.bias;

    activations[this.index] = activation;
    return { activation, value: 0 };
  }

  private activateNeuronActivation(): { activation: number; value: number } {
    const state = this.creature.state;
    const activations = state.activations;
    const activation = this.activateProxy(this);

    activations[this.index] = activation;
    return { activation, value: 0 };
  }

  private activateAndTraceNeuronActivation(): {
    activation: number;
    value: number;
  } {
    const state = this.creature.state;
    const activations = state.activations;
    const activation = this.activateAndTraceProxy(this);

    activations[this.index] = activation;
    return { activation, value: 0 };
  }

  private activateAndTraceLinear(): { activation: number; value: number } {
    const { activation, value } = this.activateNeuron();
    const state = this.creature.state;
    const ns = state.node(this.index);
    ns.hintValue = value;

    return { activation, value };
  }

  private squashProxy(_value: number): number {
    throw new Error("Not implemented");
  }
  private activateProxy(_neuron: Neuron): number {
    throw new Error("Not implemented");
  }

  private activateAndTraceProxy(_neuron: Neuron): number {
    throw new Error("Not implemented");
  }

  /**
   * Activates the node without calculating eligibility traces and such
   */
  activateNeuron(): { activation: number; value: number } {
    throw new Error("Not implemented");
  }

  /**
   * Activates the node
   */
  activateAndTraceNeuron(): { activation: number; value: number } {
    throw new Error("Not implemented");
  }

  /**
   * Apply the learnings from the previous training.
   * @returns true if changed
   */
  applyLearnings(): boolean {
    const state = this.creature.state;
    const neuronState = state.node(this.index);
    if (neuronState.noChange) return false;
    if (this.type === "hidden" || this.type === "output") {
      const squashMethod = this.findSquash();

      if (this.hasApplyLearnings(squashMethod)) {
        return squashMethod.applyLearnings(this);
      }
    }

    return false;
  }

  propagateUpdate(config: BackPropagationConfig) {
    const state = this.creature.state;
    const toList = this.creature.inwardConnections(this.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const cs = state.connection(c.from, c.to);
      const aWeight = calculateWeight(cs, c, config);
      c.weight = aWeight;
    }

    const aBias = calculateBias(this, config);

    this.bias = aBias;
  }

  /**
   * Back-propagate the known activation, aka learn
   */
  propagate(
    requestedActivation: number,
    config: BackPropagationConfig,
    sparseConfig: SparseConfig,
  ): number {
    const activation = this.adjustedActivation(config);
    if (
      sparseConfig.propagateNeeded(this.uuid) === false
    ) {
      return activation;
    }
    const squashMethod = this.findSquash();
    const targetActivation = squashMethod.range.limit(requestedActivation);

    const state = this.creature.state;
    const rawErrorAbs = Math.abs(targetActivation - activation);
    if (
      rawErrorAbs < config.plankConstant
    ) {
      noChangePropagate(this, activation, config);
      state.cacheAdjustedActivation.set(this.index, activation);
      return targetActivation;
    }

    const ns = state.node(this.index);
    ns.totalErrorAbsolute += rawErrorAbs;

    const updateNeeded = sparseConfig.updateNeeded(this.uuid);

    /* this node is not changed if the update is not needed */
    ns.noChange = updateNeeded === false;

    let limitedActivation: number;

    const propagateUpdateMethod = squashMethod as NeuronActivationInterface;
    if (propagateUpdateMethod.propagate !== undefined) {
      limitedActivation = propagateUpdateMethod.propagate(
        this,
        targetActivation,
        config,
        sparseConfig,
      );
    } else {
      let targetValue: number | undefined;

      const currentBias = adjustedBias(this, config);
      let improvedValue = currentBias;
      const inwardList = this.creature.inwardConnections(this.index);

      const listLength = inwardList.length;

      if (listLength) {
        // Issue #1377 - Fused backward pass error distribution in WASM.
        // Combines calculateError + safeZoneAdjustment + elastic distribution
        // into a single WASM call, eliminating S+1 boundary crossings and
        // keeping all intermediate float values in WASM linear memory.
        //
        // For non-eligible synapses (self-loops, input/constant neurons), we
        // use values that produce correct behaviour in the fused function:
        // - Self-loops: activation=0 → elastic score=0 (excluded from distribution)
        // - Input/constant: squash=Identity → safeZone=1 (fully safe)
        const fromActivationCache = new Array<number>(listLength);
        const fromWeightCache = new Array<number>(listLength);
        const fromValueCache = new Array<number>(listLength);
        const safeZoneFactorCache = new Array<number>(listLength);

        const fusedSquashTypes = new Uint8Array(listLength);
        const fusedHintValues = new Float32Array(listLength);
        const fusedActivations = new Float32Array(listLength);
        const fusedWeights = new Float32Array(listLength);

        for (let indx = 0; indx < listLength; indx++) {
          const c = inwardList[indx];
          const { from, to } = c;

          if (from === to) {
            // Self-loop: activation=0 makes elastic score=0
            fromActivationCache[indx] = 0;
            fromWeightCache[indx] = 0;
            fromValueCache[indx] = 0;
            fusedSquashTypes[indx] = SquashType.Identity;
            fusedHintValues[indx] = 0;
            fusedActivations[indx] = 0;
            fusedWeights[indx] = 0;
            continue;
          }

          const fromNeuron = this.creature.neurons[from];
          const fromActivation = fromNeuron.adjustedActivation(config);
          const fromWeight = adjustedWeight(state, c, config);

          fromActivationCache[indx] = fromActivation;
          fromWeightCache[indx] = fromWeight;
          fromValueCache[indx] = fromWeight * fromActivation;
          fusedActivations[indx] = fromActivation;
          fusedWeights[indx] = fromWeight;

          const type = fromNeuron.type;
          if (
            type !== "input" &&
            type !== "constant" &&
            sparseConfig.propagateNeeded(fromNeuron.uuid)
          ) {
            // Eligible: use actual squash type and hint value
            // Issue #1378: Use pre-computed cached squash type
            const fromNS = state.node(from);
            fusedSquashTypes[indx] = fromNeuron.cachedSquashType();
            fusedHintValues[indx] = fromNS.hintValue;
          } else {
            // Input/constant/non-propagated: Identity squash → safeZone=1
            fusedSquashTypes[indx] = SquashType.Identity;
            fusedHintValues[indx] = 0;
          }
        }

        // Single fused WASM call: calculateError + safeZoneAdjustment + elastic
        // Issue #1378: Use pre-computed cached squash type
        const fusedResult = fusedErrorDistribution(
          this.cachedSquashType(),
          activation,
          targetActivation,
          ns.hintValue,
          fusedSquashTypes,
          fusedHintValues,
          fusedActivations,
          fusedWeights,
        );

        const error = fusedResult.error;

        // Extract safe zone factors for recursion guards below.
        // Override self-loops to 0 (the fused function sees Identity which
        // returns 1.0, but self-loops must be blocked for hasUsableSafeZone).
        for (let i = 0; i < listLength; i++) {
          const c = inwardList[i];
          if (c.from === c.to) {
            safeZoneFactorCache[i] = 0;
          } else {
            safeZoneFactorCache[i] = fusedResult.safeZoneFactors[i];
          }
        }

        // If every upstream link is blocked by safe-zone (eg. parents are deep
        // in saturation), the fused function's elastic denominator collapses to
        // ~0 and it falls back to an equal split. However, we prefer the
        // activation²-only distribution (ignoring safe zones) for this case.
        let perLinkError: Float32Array | number[];
        let hasUsableSafeZone = false;
        for (let i = 0; i < listLength; i++) {
          const safe = safeZoneFactorCache[i] ?? 1;
          if (Number.isFinite(safe) && safe > config.plankConstant) {
            hasUsableSafeZone = true;
            break;
          }
        }
        if (hasUsableSafeZone) {
          perLinkError = fusedResult.perLinkError;
        } else {
          // Fallback: ignore safe zones, use activation² only
          const fallbackMeta = new Array(listLength);
          for (let i = 0; i < listLength; i++) {
            fallbackMeta[i] = {
              activation: fusedActivations[i],
              safeZoneFactor: 1,
            };
          }
          perLinkError = distributeElasticError(error, fallbackMeta, {
            plankConstant: config.plankConstant,
          });
        }

        for (let indx = 0; indx < listLength; indx++) {
          const c = inwardList[indx];
          const { from, to } = c;

          if (from === to) continue;

          const fromNeuron = this.creature.neurons[from];

          const fromActivation = fromActivationCache[indx];
          const fromWeight = fromWeightCache[indx];
          if (Math.abs(fromWeight) <= config.plankConstant) continue;

          const fromValue = fromValueCache[indx];
          const thisLinkError = perLinkError[indx] ?? 0;
          const targetFromValue = fromValue + thisLinkError;

          let improvedFromActivation = fromActivation;

          const type = fromNeuron.type;
          if (
            type !== "input" &&
            type !== "constant" &&
            sparseConfig.propagateNeeded(fromNeuron.uuid) &&
            Math.abs(targetFromValue - fromValue) > config.plankConstant
          ) {
            const targetFromActivation = targetFromValue / fromWeight;
            // Training-time constraint:
            // Avoid recursing into parents when the implied activation target is
            // infeasible for their squash range (common when this link's weight
            // is tiny: (fromValue + share) / weight explodes).
            //
            // In this situation, the best minimum-change action is usually to
            // adjust the *current* neuron's inbound weights/biases rather than
            // forcing an upstream neuron to chase an impossible activation.
            const safeZoneFactor = safeZoneFactorCache[indx] ?? 1;
            if (Number.isFinite(safeZoneFactor) && safeZoneFactor > 0) {
              const fromSquash = fromNeuron.findSquash();
              const range = fromSquash.range;
              const eps = 1e-9;
              const outOfRange = targetFromActivation < range.low - eps ||
                targetFromActivation > range.high + eps;
              if (!outOfRange && Number.isFinite(targetFromActivation)) {
                improvedFromActivation = fromNeuron.propagate(
                  targetFromActivation,
                  config,
                  sparseConfig,
                );
              }
            }
          }

          if (
            updateNeeded &&
            Math.abs(improvedFromActivation) > config.plankConstant
          ) {
            const cs = state.connection(from, to);
            accumulateWeight(
              c.weight,
              cs,
              targetFromValue,
              improvedFromActivation,
              config,
            );
            const aWeight = adjustedWeight(state, c, config);

            const improvedFromValue = improvedFromActivation * aWeight;
            improvedValue += improvedFromValue;
          }
        }
      }

      if (updateNeeded) {
        if (targetValue === undefined) {
          targetValue = toValue(this, targetActivation, ns.hintValue);
        }

        accumulateBias(
          ns,
          targetValue,
          improvedValue,
          currentBias,
          config,
        );

        const aBias = adjustedBias(this, config);
        // Issue #1143 - Use WASM squash when available
        limitedActivation = wasmSquash(
          this.squash!,
          improvedValue + aBias - currentBias,
        );
      } else {
        // Issue #1143 - Use WASM squash when available
        limitedActivation = wasmSquash(
          this.squash!,
          improvedValue,
        );
      }
    }

    if (updateNeeded) {
      ns.traceActivation(limitedActivation);
    }
    state.cacheAdjustedActivation.set(
      this.index,
      limitedActivation,
    );
    return limitedActivation;
  }

  /**
   * Record the error for the neuron.
   */
  record(
    requestedActivation: number,
    discoverMap: Map<string, DiscoverRecord>,
  ): void {
    const squashMethod = this.findSquash();
    const inwardList = this.creature.inwardConnections(this.index);
    const listLength = inwardList.length;
    const state = this.creature.state;
    const currentActivation = state.activations[this.index];

    let discoverRecord = discoverMap.get(this.uuid);
    const isNewRecord = discoverRecord === undefined;
    if (discoverRecord === undefined) {
      discoverRecord = {
        activation: currentActivation,
        errors: [],
      };
      assert(discoverRecord !== undefined);
      discoverMap.set(this.uuid, discoverRecord);
    }

    // DIAGNOSTIC: Log if we're accumulating excessive errors
    // Note: Errors accumulate from all paths (correct behavior), but recursion should only happen once
    if (!isNewRecord && discoverRecord.errors.length > 200) {
      console.warn(
        `⚠️  PERFORMANCE: Neuron ${this.uuid} has ${discoverRecord.errors.length} accumulated errors`,
      );
      console.warn(
        `  Type: ${this.type}, Inward connections: ${listLength}`,
      );
      if (discoverRecord.errors.length > 500) {
        console.error(
          `❌ CRITICAL: Neuron ${this.uuid} has ${discoverRecord.errors.length} errors - likely infinite recursion!`,
        );
        throw new Error(
          `Excessive error accumulation detected on neuron ${this.uuid}. ` +
            `Got ${discoverRecord.errors.length} errors. ` +
            `This suggests infinite recursion in backpropagation.`,
        );
      }
    }

    const propagateUpdateMethod = squashMethod as NeuronActivationInterface;
    if (propagateUpdateMethod.record !== undefined) {
      propagateUpdateMethod.record(
        this,
        requestedActivation,
        discoverMap,
      );
    } else {
      const targetActivation = squashMethod.range.limit(requestedActivation);

      let currentValue = discoverRecord.value;
      if (Number.isFinite(currentValue) === false) {
        currentValue = this.bias;
        if (this.type !== "constant") {
          for (let indx = 0; indx < listLength; indx++) {
            const c = inwardList[indx];

            const fromActivation = state.activations[c.from];

            const fromValue = c.weight * fromActivation;
            currentValue += fromValue;
          }
        }
        discoverRecord.value = currentValue;
      }

      let error = 0;
      if (Math.abs(targetActivation - currentActivation) > 1e-8) {
        // Issue #1143 - Use WASM calculateError when available
        // This handles both activation-specific error semantics (eg. STEP/BIPOLAR
        // clamp error) and falls back appropriately when not supported.
        error = wasmCalculateError(
          this.squash!,
          currentActivation,
          targetActivation,
          currentValue!,
        );
      }

      // CRITICAL FIX: Track if this is the first visit to this neuron
      // Only process and record error on first visit to prevent exponential recursion
      const isFirstVisit = discoverRecord.errors.length === 0;

      // Only process on first visit (prevents duplicate errors and exponential recursion)
      if (isFirstVisit) {
        discoverRecord.errors.push(error);

        if (listLength) {
          // Elastic record attribution: prefer pushing error through upstream
          // neurons that are in their safe zone (plastic), and avoid pushing
          // saturated parents unless there is no alternative.
          const provisionalErrorPerLink = error / listLength;
          const links = buildRecordElasticLinks(
            this,
            inwardList,
            discoverMap,
            provisionalErrorPerLink,
          );
          const { links: chosenLinks, shares } = distributeRecordError(
            error,
            links,
            {
              plankConstant: 1e-12,
              allowEqualFallback: true, // last resort if all are blocked
            },
          );

          const plankConstant = 1e-12;

          // Clamp each per-link share to what its upstream squash can actually
          // accept (or what we strongly prefer), then redistribute residue.
          //
          // Example: ABSOLUTE ∈ [0, +∞). If a share implies a negative target,
          // we clamp to the boundary (target=0) and push the remaining error
          // into other links.
          const constrainedShares = constrainAndRedistributeRecordShares(
            error,
            chosenLinks,
            shares,
            { plankConstant },
          );

          for (let i = 0; i < chosenLinks.length; i++) {
            const link = chosenLinks[i];
            const share = constrainedShares[i] ?? 0;
            if (!Number.isFinite(share) || Math.abs(share) <= plankConstant) {
              continue;
            }

            // Safe-zone hard guard: do not recurse into fully blocked parents.
            if (
              !Number.isFinite(link.safeZoneFactor) || link.safeZoneFactor <= 0
            ) {
              continue;
            }

            const fromNeuron = link.fromNeuron;
            const weight = link.synapse.weight;
            if (!weight) continue;

            const targetFromValue = link.fromValue + share;
            const targetFromActivation = targetFromValue / weight;

            fromNeuron.record(targetFromActivation, discoverMap);
          }
        }
      }
    }
  }

  /**
   * Adjusts the activation based on the current state
   */
  adjustedActivation(config: BackPropagationConfig): number {
    const state = this.creature.state;
    const cache = state.cacheAdjustedActivation;
    const cachedValue = cache.get(this.index);

    if (cachedValue !== undefined) {
      return cachedValue;
    }
    const value = this.rawAdjustedActivation(config);

    cache.set(this.index, value);
    return value;
  }

  rawAdjustedActivation(config: BackPropagationConfig): number {
    const state = this.creature.state;
    if (this.type === "input") {
      return state.activations[this.index];
    } else if (this.type === "constant") {
      return this.bias;
    } else {
      const squashMethod = this.findSquash();
      if (this.isNodeActivation(squashMethod)) {
        const activation = squashMethod.activate(this);
        squashMethod.range.validate(activation);
        return activation;
      } else {
        // All activation sources coming from the node itself

        const toList = this.creature.inwardConnections(this.index);
        const aBias = adjustedBias(this, config);
        let value = aBias;

        for (let i = toList.length; i--;) {
          const c = toList[i];
          if (c.from === c.to) continue;
          const fromActivation = this.creature.neurons[c.from]
            .adjustedActivation(config);

          const fromWeight = adjustedWeight(
            state,
            c,
            config,
          );

          const fromValue = fromActivation * fromWeight;
          value += fromValue;
        }

        const activationSquash = squashMethod as ActivationInterface;
        // Squash the values received
        const activation = activationSquash.squash(value);
        activationSquash.range.validate(activation);

        return activation;
      }
    }
  }

  /**
   * Disconnects this node from the other node
   */
  disconnect(to: number, twoSided: boolean) {
    this.creature.disconnect(this.index, to);
    if (twoSided) {
      this.creature.disconnect(to, this.index);
    }
  }

  /**
   * Mutates the node with the given method
   */
  mutate(method: string): boolean {
    if (typeof method !== "string") {
      throw new Error("Mutate method wrong type: " + (typeof method));
    }
    if (this.type === "input") {
      throw new Error("Mutate on wrong node type: " + this.type);
    }
    let changed = false;
    switch (method) {
      case Mutation.MOD_SQUASH.name: {
        switch (this.type) {
          case "hidden":
          case "output":
            break;
          default:
            throw new Error(`Can't modify activation for type ${this.type}`);
        }
        const tmpSquash = Activations.pickRandomSquash(this.squash);

        this.setSquash(tmpSquash);

        removeTag(this, "CRISPR");
        changed = true;
        break;
      }
      case Mutation.MOD_BIAS.name: {
        // Calculate the quantum based on the current bias
        const biasMagnitude = Math.abs(this.bias);
        let quantum = 1;

        if (biasMagnitude >= 1) {
          // Find the largest power of 10 smaller than the biasMagnitude
          quantum = Math.pow(10, Math.floor(Math.log10(biasMagnitude)));
        }

        // Generate a random modification value based on the quantum
        const modification = (Math.random() * 2 - 1) * quantum;

        this.bias += modification;
        changed = true;
        break;
      }
      default:
        throw new Error("Unknown mutate method: " + method);
    }
    if (changed) {
      delete this.creature.uuid;
      this.creature.state.preparedNeurons = false;
    }
    return changed;
  }

  /**
   * Checks if this node is projecting to the given node
   */
  isProjectingTo(node: Neuron): boolean {
    const c = this.creature.getSynapse(this.index, node.index);
    return c !== null;
  }

  /**
   * Converts the node to a json object
   */
  exportJSON(): NeuronExport {
    if (this.type === "input") {
      throw new Error(`Should not be exporting 'input'`);
    } else if (this.type === "constant") {
      return {
        type: this.type,
        uuid: this.uuid,
        bias: this.bias,
        tags: this.tags ? [...this.tags] : undefined,
      };
    } else {
      return {
        type: this.type,
        uuid: this.uuid,
        bias: this.bias,
        squash: this.squash,
        tags: this.tags ? [...this.tags] : undefined,
      };
    }
  }

  /**
   * Converts the node to a json object
   */
  internalJSON(indx: number): NeuronInternal {
    if (this.type === "input") {
      return {
        type: this.type,
        index: indx,
        tags: this.tags ? [...this.tags] : undefined,
      };
    } else if (this.type === "constant") {
      return {
        type: this.type,
        index: indx,
        uuid: this.uuid,
        bias: this.bias,
        tags: this.tags ? [...this.tags] : undefined,
      };
    } else {
      return {
        type: this.type,
        index: indx,
        uuid: this.uuid,
        bias: this.bias,
        squash: this.squash,
        tags: this.tags ? [...this.tags] : undefined,
      };
    }
  }

  /**
   * Convert a json object to a node
   */
  static fromJSON(
    json: NeuronExport | NeuronInternal,
    creature: Creature,
  ): Neuron {
    const neuron = new Neuron(
      json.uuid ? json.uuid : crypto.randomUUID(),
      json.type,
      json.bias ? json.bias : 0,
      creature,
      json.squash,
    );

    if (json.tags) {
      addTags(neuron, json);
    }
    return neuron;
  }
}
