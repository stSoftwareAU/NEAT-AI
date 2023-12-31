/* Import */
import { Activations } from "../methods/activations/Activations.ts";
import { NodeActivationInterface } from "../methods/activations/NodeActivationInterface.ts";
import { NodeFixableInterface } from "../methods/activations/NodeFixableInterface.ts";
import { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Mutation } from "../methods/mutation.ts";
import { Connection } from "./Connection.ts";
import { addTags, removeTag, TagsInterface } from "../tags/TagsInterface.ts";
import { NodeExport, NodeInternal } from "./NodeInterfaces.ts";
import { ApplyLearningsInterface } from "../methods/activations/ApplyLearningsInterface.ts";
import { Network } from "./Network.ts";
import { ConnectionInternal } from "./ConnectionInterfaces.ts";
import { UnSquashInterface } from "../methods/activations/UnSquashInterface.ts";
import { PLANK_CONSTANT } from "../config/NeatConfig.ts";
import {
  BackPropagationConfig,
  BackPropagationOptions,
  MAX_BIAS,
  MAX_WEIGHT,
} from "./BackPropagation.ts";

export class Node implements TagsInterface, NodeInternal {
  readonly network: Network;
  readonly type;
  uuid: string;
  bias: number;
  squash?: string;
  private squashMethodCache?: NodeActivationInterface | ActivationInterface;
  public index: number;
  public tags = undefined;

  constructor(
    uuid: string,
    type: "input" | "output" | "hidden" | "constant",
    bias: number | undefined,
    network: Network,
    squash?: string,
  ) {
    this.uuid = uuid;
    if (!type) {
      console.trace();
      throw "type must be defined: " + (typeof type);
    }

    if (type !== "input") {
      if (type !== "output" && type !== "hidden" && type !== "constant") {
        console.trace();
        throw "invalid type: " + type;
      }

      if (bias === undefined) {
        this.bias = Math.random() * 0.2 - 0.1;
      } else {
        if (!Number.isFinite(bias)) {
          console.trace();
          throw "bias (other than for 'input') must be a number type: " + type +
            ", typeof: " +
            (typeof bias) + ", value: " + bias;
        }
        this.bias = bias;
      }

      if (type == "constant") {
        if (squash) {
          throw "constants should not a have a squash was: " + squash;
        }
      } else {
        this.squash = squash;
      }
    } else {
      this.bias = Infinity;
    }

    if (typeof network !== "object") {
      console.trace();
      throw "network must be a Network was: " + (typeof network);
    }

    this.network = network;

    this.type = type;

    this.index = -1;
  }

  setSquash(name: string) {
    if (this.type == "constant") {
      console.trace();
      throw "Can't set the squash of a constant";
    }
    delete this.squashMethodCache;
    this.squash = name;
    return this.findSquash();
  }

  findSquash() {
    if (!this.squashMethodCache) {
      this.squashMethodCache = Activations.find(
        this.squash ? this.squash : `UNDEFINED-${this.type}-${this.index}`,
      );
    }
    return this.squashMethodCache;
  }

  fix() {
    delete this.squashMethodCache;

    if (this.squash !== "IF") {
      const toList = this.network.toConnections(this.index);
      toList.forEach((c) => {
        delete c.type;
      });
    }

    if (this.type == "hidden") {
      const fromList = this.network.fromConnections(this.index);
      if (fromList.length == 0) {
        const targetIndx = Math.min(
          1,
          Math.floor(
            Math.random() * (this.network.nodeCount() - this.index),
          ),
        ) +
          this.index;
        this.network.connect(
          this.index,
          targetIndx,
          Connection.randomWeight(),
        );
      }
      const toList = this.network.toConnections(this.index);
      if (toList.length == 0) {
        const fromIndx = Math.floor(Math.random() * this.index);
        this.network.connect(
          fromIndx,
          this.index,
          Connection.randomWeight(),
        );
      }
    } else if (this.type == "output") {
      const toList = this.network.toConnections(this.index);
      if (toList.length == 0) {
        const fromIndx = Math.floor(
          Math.random() *
            (this.network.nodeCount() - this.network.outputCount()),
        );
        this.network.connect(
          fromIndx,
          this.index,
          Connection.randomWeight(),
        );
      }
    }

    if (this.squash) {
      const activation = this.findSquash();

      if (this.isFixableActivation(activation)) {
        activation.fix(this);
      }
    }
  }

  private isNodeActivation(
    activation: NodeActivationInterface | ActivationInterface,
  ): activation is NodeActivationInterface {
    return (activation as NodeActivationInterface).activate != undefined;
  }

  private hasApplyLearnings(
    activation:
      | ApplyLearningsInterface
      | NodeActivationInterface
      | ActivationInterface,
  ): activation is ApplyLearningsInterface {
    return (activation as ApplyLearningsInterface).applyLearnings != undefined;
  }

  private isFixableActivation(
    activation:
      | NodeActivationInterface
      | ActivationInterface
      | NodeFixableInterface,
  ): activation is NodeFixableInterface {
    return (activation as NodeFixableInterface).fix != undefined;
  }

  /**
   * Activates the node
   */
  activate() {
    let activation: number;
    if (this.type == "constant") {
      activation = this.bias;
    } else {
      const squashMethod = this.findSquash();

      if (this.isNodeActivation(squashMethod)) {
        const squashActivation = squashMethod.activate(this);
        activation = squashActivation + this.bias;
      } else {
        const toList = this.network.toConnections(this.index);
        let value = this.bias;

        for (let i = toList.length; i--;) {
          const c = toList[i];

          const fromActivation = this.network.getActivation(c.from);

          value += fromActivation * c.weight;
        }

        const activationSquash = squashMethod as ActivationInterface;
        const result = activationSquash.squashAndDerive(value);
        // Squash the values received
        activation = result.activation;
        if (!Number.isFinite(activation)) {
          if (activation === Number.POSITIVE_INFINITY) {
            activation = Number.MAX_SAFE_INTEGER;
          } else if (activation === Number.NEGATIVE_INFINITY) {
            activation = Number.MIN_SAFE_INTEGER;
          } else if (isNaN(activation)) {
            activation = 0;
          } else {
            console.trace();
            throw this.index + ") invalid value: + " + result +
              ", squash: " +
              this.squash +
              ", activation: " + activation;
          }
        }
      }
    }

    this.network.networkState.activations[this.index] = activation;
    return activation;
  }

  /**
   * Apply the learnings from the previous training.
   * @returns true if changed
   */
  applyLearnings() {
    if (this.type == "hidden" || this.type == "output") {
      const squashMethod = this.findSquash();

      if (this.hasApplyLearnings(squashMethod)) {
        return squashMethod.applyLearnings(this);
      }
    }

    return false;
  }

  /**
   * Activates the node without calculating eligibility traces and such
   */
  noTraceActivate() {
    let activation: number;

    if (this.type == "constant") {
      activation = this.bias;
    } else {
      const squashMethod = this.findSquash();
      if (this.isNodeActivation(squashMethod)) {
        activation = squashMethod.noTraceActivate(this) + this.bias;
      } else {
        // All activation sources coming from the node itself

        const toList = this.network.toConnections(this.index);
        let value = this.bias;

        for (let i = toList.length; i--;) {
          const c = toList[i];
          const fromActivation = this.network.getActivation(c.from);

          value += fromActivation * c.weight;
        }

        const activationSquash = squashMethod as ActivationInterface;
        // Squash the values received
        activation = activationSquash.squash(value);

        if (!Number.isFinite(activation)) {
          if (activation === Number.POSITIVE_INFINITY) {
            activation = Number.MAX_SAFE_INTEGER;
          } else if (activation === Number.NEGATIVE_INFINITY) {
            activation = Number.MIN_SAFE_INTEGER;
          } else if (isNaN(activation)) {
            activation = 0;
          } else {
            const msg = this.index + ") invalid value:" + value +
              ", squash: " +
              this.squash +
              ", activation: " +
              activation;
            console.warn(msg);
            console.trace();
            activation = Number.MAX_SAFE_INTEGER;
          }
        }
      }
    }
    this.network.networkState.activations[this.index] = activation;

    // console.info(
    //   `${this.index}: noTraceActivate ${activation.toFixed(3)}, bias ${
    //     this.bias.toFixed(3)
    //   }`,
    // );
    return activation;
  }

  // private limit(delta: number, limit: number) {
  //   if (!Number.isFinite(delta)) {
  //     return 0;
  //   }

  //   const limitedDelta = Math.min(
  //     Math.max(delta, Math.abs(limit) * -1),
  //     Math.abs(limit),
  //   );

  //   return limitedDelta;
  // }

  private adjustedWeight(
    c: ConnectionInternal,
    options: BackPropagationOptions,
  ) {
    const cs = this.network.networkState.connection(c.from, c.to);

    if (cs.totalActivation) {
      // Constants Few expect 4.5

      // const weightB= cs.totalValue / Math.abs(cs.totalActivation); // FAILS: Constants Few 1.4

      const averageValuePerActivation = cs.totalValue / cs.totalActivation; // BEST so far FAILS: Constants Few -18.6
      const averageValuePerAbsoluteActivation = cs.totalValue /
        cs.absoluteActivation; // FAILS: Constants Few 4.5

      // console.info(
      //   `${this.index}: weight: ${c.weight} averageValuePerActivation ${averageValuePerActivation} averageValuePerAbsoluteActivation ${averageValuePerAbsoluteActivation}`,
      // );

      // if( true || Math.abs(averageValuePerActivation ) < Math.abs(averageValuePerAbsoluteActivation)){
      if (options.useAverageValuePerActivation) {
        //   console.info(`${this.index}: averageValuePerActivation ${averageValuePerActivation}`);
        if (Number.isFinite(averageValuePerActivation)) {
          if (Math.abs(averageValuePerActivation) < MAX_WEIGHT) {
            return averageValuePerActivation;
          } else if (averageValuePerActivation > 0) {
            return MAX_WEIGHT;
          } else {
            return -MAX_WEIGHT;
          }
        } else {
          console.info(
            `${this.index}: Invalid Weight : averageValuePerActivation ${averageValuePerActivation}`,
          );
          return c.weight;
        }
      } else {
        // console.info(
        //   `${this.index}: averageValuePerAbsoluteActivation ${averageValuePerAbsoluteActivation}`,
        // );
        if (averageValuePerAbsoluteActivation > MAX_WEIGHT) {
          return MAX_WEIGHT;
        } else if (averageValuePerAbsoluteActivation < -MAX_WEIGHT) {
          return -MAX_WEIGHT;
        } else {
          return averageValuePerAbsoluteActivation;
        }
      }
    } else {
      return c.weight;
    }
  }

  private adjustedBias(config: BackPropagationConfig): number {
    if (this.type == "constant") {
      return this.bias ? this.bias : 0;
    } else {
      const ns = this.network.networkState.node(this.index);

      if (ns.count) {
        // console.info(
        //   `${this.index}: adjustedBias A: ${ns.totalValue} / ${ns.absoluteWeightedSum} = ${
        //     ns.totalValue / ns.absoluteWeightedSum
        //   }`,
        // );
        // console.info(
        //   `${this.index}: adjustedBias B: ${ns.totalValue} / ${ns.totalWeightedSum} = ${
        //     ns.totalValue / ns.totalWeightedSum
        //   }`,
        // );
        // console.info(
        //   `${this.index}: adjustedBias C: (${ns.totalValue} - ${ns.totalWeightedSum})/${ns.count} = ${
        //     (ns.totalValue - ns.totalWeightedSum) / ns.count
        //   }`,
        // );
        // console.info(
        //   `${this.index}: adjustedBias D: 1-(${ns.totalValue} / ${ns.totalWeightedSum}) = ${
        //     1 - (ns.totalValue / ns.totalWeightedSum)
        //   }`,
        // );
        // console.info(
        //   `${this.index}: adjustedBias E: 1-(${ns.totalValue} / ${ns.absoluteWeightedSum}) = ${
        //     1 - (ns.totalValue / ns.absoluteWeightedSum)
        //   }`,
        // );
        // console.info(
        //   `${this.index}: adjustedBias F: (${ns.totalValue} - ${ns.absoluteWeightedSum})/${ns.count} = ${
        //     (ns.totalValue - ns.absoluteWeightedSum) / ns.count
        //   }`,
        // );
        // console.info(
        //   `${this.index}: adjustedBias G: (${ns.totalValue} - Math.abs(${ns.totalWeightedSum}))/${ns.count} = ${
        //     (ns.totalValue - Math.abs(ns.totalWeightedSum)) / ns.count
        //   }`,
        // );
        // console.info(
        //   `${this.index}: adjustedBias H: ((${ns.totalValue} - ${ns.totalWeightedSum})/${ns.count})-1 = ${
        //     ((ns.totalValue - ns.totalWeightedSum) / ns.count) - 1
        //   }`,
        // );

        // console.info(
        //   `${this.index}: adjustedBias I: (${ns.totalValue} - ${ns.totalWeightedSum} + ${ns.totalError})/${ns.count}= ${
        //     (ns.totalValue - ns.totalWeightedSum + ns.totalError) / ns.count
        //   }`,
        // );

        // console.info(
        //   `${this.index}: adjustedBias J: (${ns.totalValue} - ${ns.totalWeightedSum} - ${ns.totalError})/${ns.count}= ${
        //     (ns.totalValue - ns.totalWeightedSum - ns.totalError) / ns.count
        //   }`,
        // );

        // console.info(
        //   `${this.index}: adjustedBias K: (${ns.totalValue} - ${ns.totalWeightedSum})/${ns.count} - ${ns.totalError}= ${
        //     (ns.totalValue - ns.totalWeightedSum) / ns.count - ns.totalError
        //   }`,
        // );

        // console.info(
        //   `${this.index}: adjustedBias L: (${ns.totalValue} - ${ns.totalWeightedSum})/${ns.count} - ${ns.totalError}= ${
        //     (ns.totalValue - ns.totalWeightedSum) / ns.count + ns.totalError
        //   }`,
        // );

        /* Constant Few expect 4.5 */

        // return ns.totalValue / ns.absoluteWeightedSum; // A FAILS: Constants Few 5
        // return ns.totalValue / ns.totalWeightedSum; // B FAILS: Constants Few 4.2

        const averageDifferenceBias = (ns.totalValue - ns.totalWeightedSum) /
          ns.count; // C best so far FAILS: Constants Few 3

        const unaccountedRatioBias = 1 - (ns.totalValue / ns.totalWeightedSum); // D FAILS: Constants Few 4.5 best
        // const averageError = ns.totalError / ns.count;

        // console.info(
        //   `${this.index}: bias: ${this.bias} averageDifferenceBias ${averageDifferenceBias} unaccountedRatioBias ${unaccountedRatioBias} error ${ns.totalError} count ${ns.count} averageError ${averageError}`,
        // );
        if (
          Number.isFinite(averageDifferenceBias) == false ||
          Number.isFinite(unaccountedRatioBias) == false
        ) {
          console.info(
            `${this.index}: Invalid Bias : averageDifferenceBias ${averageDifferenceBias} unaccountedRatioBias ${unaccountedRatioBias}`,
          );
        }
        // if( false && Math.abs(averageError) < 2){
        if (
          config.useAverageDifferenceBias == "Yes" ||
          Number.isFinite(unaccountedRatioBias) == false
        ) {
          if (averageDifferenceBias > MAX_BIAS) {
            return MAX_BIAS;
          } else if (averageDifferenceBias < -MAX_BIAS) {
            return -MAX_BIAS;
          } else {
            return averageDifferenceBias;
          }
        } else if (
          config.useAverageDifferenceBias == "No" ||
          (
            Math.abs(averageDifferenceBias - this.bias) <
              Math.abs(unaccountedRatioBias - this.bias)
          )
        ) {
          return unaccountedRatioBias;
        } else {
          return averageDifferenceBias;
        }

        // if( Math.abs(averageDifferenceBias-this.bias) < Math.abs(unaccountedRatioBias-this.bias)){
        // return averageDifferenceBias;
        // }
        // else{
        // }
        // }
        // else{
        // return unaccountedRatioBias;
        // }

        // return 1-(ns.totalValue / ns.totalWeightedSum); // D FAILS: Constants Few 4.5 best
        // return 1-(ns.totalValue / ns.absoluteWeightedSum); // E FAILS: Constants Few 0.5
        // return (ns.totalValue - ns.absoluteWeightedSum)/ns.count; // F FAILS: Constants Few 2.4
        // return (ns.totalValue - Math.abs(ns.totalWeightedSum))/ns.count; // G FAILS: Constants Few 3
        // return ((ns.totalValue - ns.totalWeightedSum)/ns.count)-1; // H FAILS: Constants Few 2.5
        // return (ns.totalValue - ns.totalWeightedSum + ns.totalError) / ns.count; // I FAILS: Constants Few 4.35
        // return (ns.totalValue - ns.totalWeightedSum - ns.totalError) / ns.count; // J FAILS: Constants Few 1

        // return  (ns.totalValue - ns.totalWeightedSum ) / ns.count - ns.totalError; // K FAILS: Constants Few -3.76
        // return  (ns.totalValue - ns.totalWeightedSum ) / ns.count + ns.totalError; // L FAILS: Constants Few 8.7

        // return ns.totalValue / ns.absoluteWeightedSum - 1;
        // const totalBias = ns.totalValue - ns.totalWeightedSum;
        // const avgBias = totalBias / ns.count;
        // if (!Number.isFinite(avgBias)) {
        //   console.trace();
        //   throw `${this.index}: invalid adjusted bias: ${avgBias}`;
        // }
        // return avgBias;
      } else {
        return this.bias;
      }
    }
  }

  propagateUpdate(config: BackPropagationConfig) {
    const toList = this.network.toConnections(this.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];
      const adjustedWeight = this.adjustedWeight(c, config);

      c.weight = adjustedWeight;
    }

    const adjustedBias = this.adjustedBias(config);

    this.bias = adjustedBias;
  }

  private toValue(activation: number) {
    if (this.type == "input" || this.type == "constant") {
      return activation;
    }
    const squash = this.findSquash();
    if (((squash as unknown) as UnSquashInterface).unSquash != undefined) {
      const unSquasher = (squash as unknown) as UnSquashInterface;
      const value = unSquasher.unSquash(activation);

      if (!Number.isFinite(value)) {
        console.trace();
        throw `${this.index}: ${this.squash}.unSquash(${activation}) invalid -> ${value}`;
      }
      return value;
    } else {
      return activation;
    }
  }

  private readonly MAX_ADJUST = 2;

  // private limit(delta: number, limit: number) {
  //   if (!Number.isFinite(delta)) {
  //     return 0;
  //   }

  //   const limitedDelta = Math.min(
  //     Math.max(delta, Math.abs(limit) * -1),
  //     Math.abs(limit),
  //   );

  //   return limitedDelta;
  // }

  /**
   * Back-propagate the error, aka learn
   */
  propagate(
    targetActivation: number,
    config: BackPropagationConfig,
  ) {
    const activation = this.adjustedActivation(config);

    const targetValue = this.toValue(targetActivation);
    const activationValue = this.toValue(activation);
    const error = targetValue - activationValue;

    let targetWeightedSum = 0;
    const toList = this.network.toConnections(this.index);

    const randomList = toList.slice().filter((c) => {
      /** Skip over self */
      return c.from != c.to;
    });

    const listLength = randomList.length;

    if (listLength > 1 && !(config.disableRandomList)) {
      randomList.sort(() => Math.random() - 0.5);
    }

    let remainingError = error;
    if (listLength) {
      const errorPerLink = error / listLength;

      for (let indx = 0; indx < listLength; indx++) {
        let thisPerLinkError = errorPerLink;

        const c = randomList[indx];
        const fromNode = this.network.nodes[c.from];
        const fromActivation = fromNode.adjustedActivation(config);

        const cs = this.network.networkState.connection(c.from, c.to);

        const fromWeight = this.adjustedWeight(c, config);
        const fromValue = fromWeight * fromActivation;

        let improvedFromActivation = fromActivation;
        let targetFromActivation = fromActivation;
        const targetFromValue = fromValue + errorPerLink;
        let improvedFromValue = fromValue;
        if (
          fromWeight &&
          fromNode.type !== "input" &&
          fromNode.type !== "constant"
        ) {
          targetFromActivation = targetFromValue / fromWeight;

          improvedFromActivation = (fromNode as Node).propagate(
            targetFromActivation,
            config,
          );
          improvedFromValue = improvedFromActivation * fromWeight;

          thisPerLinkError = targetFromValue - improvedFromValue;

          // if (
          //   !Number.isFinite(thisPerLinkError) ||
          //   Math.abs(thisPerLinkError) > Math.abs(errorPerLink)
          // ) {
          //   console.trace();
          //   // throw msg;
          // }

          // fromValue = improvedFromValue;
        }

        if (
          Math.abs(improvedFromActivation) > PLANK_CONSTANT &&
          Math.abs(fromWeight) > PLANK_CONSTANT
        ) {
          const targetFromValue2 = fromValue + thisPerLinkError;
          // const targetFromValue2 = improvedFromValue + errorPerLink;//- thisPerLinkError);
          // const targetFromValue2 = improvedFromValue + errorPerLink;

          cs.count++;
          // cs.totalValue += improvedFromValue;
          cs.totalValue += targetFromValue2;
          cs.totalActivation += targetFromActivation;
          // cs.totalActivation += improvedFromActivation;
          cs.absoluteActivation += Math.abs(improvedFromActivation);

          const adjustedWeight = this.adjustedWeight(c, config);

          const improvedAdjustedFromValue = improvedFromActivation *
            adjustedWeight;
          // const improvedAdjustedFromValue = targetFromValue/fromWeight * adjustedWeight;

          remainingError -= //errorPerLink -
            targetFromValue - improvedAdjustedFromValue;
          targetWeightedSum += improvedAdjustedFromValue;
          // targetWeightedSum += fromActivation * adjustedWeight;
        }
      }
    }

    // if (remainingError) {
    //   console.info(
    //     `${this.index}: propagate: ${targetActivation.toFixed(3)} -> ${
    //       activation.toFixed(3)
    //     } -> ${targetValue.toFixed(3)} -> ${activationValue.toFixed(3)} -> ${
    //       error.toFixed(3)
    //     } -> ${remainingError.toFixed(3)}`,
    //   );
    // }
    const ns = this.network.networkState.node(this.index);

    ns.count++;
    ns.totalError += remainingError;
    ns.totalValue += targetValue;
    ns.totalWeightedSum += targetWeightedSum;
    ns.absoluteWeightedSum += Math.abs(targetWeightedSum);

    if (!Number.isFinite(ns.totalValue)) {
      console.trace();
      throw `${this.index}: Invalid totalValue: ${ns.totalValue}`;
    }

    const adjustedBias = this.adjustedBias(config);

    const adjustedActivation = targetWeightedSum + adjustedBias;

    const squashMethod = this.findSquash();

    if (this.isNodeActivation(squashMethod) == false) {
      const squashActivation = (squashMethod as ActivationInterface).squash(
        adjustedActivation,
      );

      return squashActivation;
    } else {
      return adjustedActivation;
    }
  }

  private adjustedActivation(config: BackPropagationConfig) {
    if (this.type == "input") {
      return this.network.networkState.activations[this.index];
    }

    if (this.type == "constant") {
      return this.bias;
    } else {
      const adjustedBias = this.adjustedBias(config);

      const squashMethod = this.findSquash();
      if (this.isNodeActivation(squashMethod)) {
        return squashMethod.noTraceActivate(this) + adjustedBias;
      } else {
        // All activation sources coming from the node itself

        const toList = this.network.toConnections(this.index);
        let value = adjustedBias;

        for (let i = toList.length; i--;) {
          const c = toList[i];
          const fromActivation = (this.network.nodes[c.from] as Node)
            .adjustedActivation(config);

          const fromWeight = this.adjustedWeight(c, config);

          value += fromActivation * fromWeight;
          // if( Math.abs( value) > 10){
          //   console.info( `${this.index} VALUE too big ${value}`);
          // }
        }

        // console.info( `${this.index}: value: ${value}, bias: ${adjustedBias}`);
        const activationSquash = squashMethod as ActivationInterface;
        // Squash the values received
        const squashedValue = activationSquash.squash(value);

        if (!Number.isFinite(squashedValue)) {
          console.info(
            `${this.index}: value: ${value}, bias: ${adjustedBias}, squashedValue: ${squashedValue}`,
          );
        }

        return squashedValue;
      }
    }
  }

  /**
   * Disconnects this node from the other node
   */
  disconnect(to: number, twoSided: boolean) {
    this.network.disconnect(this.index, to);
    if (twoSided) {
      this.network.disconnect(to, this.index);
    }
  }

  /**
   * Mutates the node with the given method
   */
  mutate(method: string) {
    if (typeof method !== "string") {
      console.trace();
      throw "Mutate method wrong type: " + (typeof method);
    }
    if (this.type == "input") {
      throw "Mutate on wrong node type: " + this.type;
    }
    switch (method) {
      case Mutation.MOD_ACTIVATION.name: {
        switch (this.type) {
          case "hidden":
          case "output":
            break;
          default:
            throw `Can't modify activation for type ${this.type}`;
        }
        // Can't be the same squash
        for (let attempts = 0; attempts < 12; attempts++) {
          const tmpSquash = Activations
            .NAMES[Math.floor(Math.random() * Activations.NAMES.length)];

          if (tmpSquash != this.squash) {
            this.squash = tmpSquash;
            delete this.squashMethodCache;
            removeTag(this, "CRISPR");
            break;
          }
        }
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
        break;
      }
      default:
        console.trace();
        throw "Unknown mutate method: " + method;
    }
    delete this.network.uuid;
  }

  /**
   * Checks if this node is projecting to the given node
   */
  isProjectingTo(node: Node) {
    const c = this.network.getConnection(this.index, node.index);
    return c != null;
  }

  /**
   * Checks if the given node is projecting to this node
   */
  isProjectedBy(node: Node) {
    const c = this.network.getConnection(node.index, this.index);
    return c != null;
  }

  /**
   * Converts the node to a json object
   */
  exportJSON(): NodeExport {
    if (this.type === "input") {
      return {
        type: this.type,
        tags: this.tags ? [...this.tags] : undefined,
      };
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
  internalJSON(indx: number): NodeInternal {
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
    json: NodeExport,
    network: Network,
  ) {
    if (typeof network !== "object") {
      console.trace();
      throw "network must be a Network was: " + (typeof network);
    }

    const node = new Node(
      json.uuid ? json.uuid : crypto.randomUUID(),
      json.type,
      json.bias,
      network,
    );

    switch (json.type) {
      case "input":
      case "constant":
        break;
      case "output":
      case "hidden":
        node.squash = json.squash;
        break;
      default:
        throw "unknown type: " + json.type;
    }

    if (json.tags) {
      addTags(node, json);
    }
    return node;
  }
}
