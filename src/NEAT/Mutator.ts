import { removeTag } from "@stsoftware/tags/mod";
import { Creature, CreatureUtil, Mutation } from "../../mod.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import { discover } from "../blackbox/Discover.ts";
import { memeticUpdate } from "../blackbox/MemeticUpdate.ts";
import type { NeatConfig } from "../config/NeatConfig.ts";
import type { RadioactiveInterface } from "../mutate/RadioactiveInterface.ts";
import { AddNeuron } from "../mutate/AddNeuron.ts";
import { SubNeuron } from "../mutate/SubNeuron.ts";
import { AddConnection } from "../mutate/AddConnection.ts";
import { SubConnection } from "../mutate/SubConnection.ts";
import { ModWeight } from "../mutate/ModWeight.ts";
import { ModBias } from "../mutate/ModBias.ts";
import { assert } from "@std/assert";
import { ModActivation as ModSquash } from "../mutate/ModSquash.ts";
import { AddSelfCon } from "../mutate/AddSelfCon.ts";
import { SubSelfCon } from "../mutate/SubSelfCon.ts";
import { AddBackCon } from "../mutate/AddBackCon.ts";
import { SubBackCon } from "../mutate/SubBackCon.ts";
import { SwapNeurons } from "../mutate/SwapNeurons.ts";

export class Mutator {
  private config: NeatConfig;
  constructor(config: NeatConfig) {
    this.config = config;
  }

  /**
   * Mutates the given (or current) population
   */
  mutate(creatures: Creature[]): void {
    for (let i = creatures.length; i--;) {
      if (Math.random() <= this.config.mutationRate) {
        const creature = creatures[i];
        let original: Creature | undefined;
        if (creature.score !== undefined || creature.memetic) {
          original = Creature.fromJSON(creature.exportJSON());
          original.score = creature.score;
        }
        let changed = false;
        for (let j = this.config.mutationAmount; j--;) {
          const mutationMethod = this.selectMutationMethod(creature);

          const flag = this.mutateCreature(
            creature,
            mutationMethod,
            Math.random() < this.config.focusRate
              ? this.config.focusList
              : undefined,
          );
          if (flag) {
            changed = true;
          }
        }

        if (this.config.debug) {
          creatureValidate(creature);
        }

        if (changed) {
          removeTag(creature, "approach");
          removeTag(creature, "approach-logged");
          removeTag(creature, "trainID");
          removeTag(creature, "trained");

          creature.clearState();
          delete creature.memetic;
          delete creature.uuid;
          creature.state.preparedNeurons = false;
          if (original) {
            const memetic = memeticUpdate(original, creature);
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
   * Selects a random mutation method for a genome according to the parameters
   */
  public selectMutationMethod(creature: Creature) {
    const mutationMethods = this.config
      .mutation;

    const feedbackLoop = this.config.feedbackLoop;
    for (let attempts = 0; true; attempts++) {
      const mutationMethod = mutationMethods[
        Math.floor(Math.random() * mutationMethods.length)
      ];

      if (Math.random() < 0.25) {
        if (
          mutationMethod.name !== Mutation.MOD_BIAS.name &&
          mutationMethod.name !== Mutation.MOD_WEIGHT.name
        ) {
          continue;
        }
      }
      switch (mutationMethod.name) {
        case Mutation.ADD_NODE.name:
          if (creature.neurons.length >= this.config.maximumNumberOfNodes) {
            continue;
          }
          break;
        case Mutation.ADD_CONN.name:
          if (
            creature.synapses.length >= this.config.maxConns ||
            creature.synapses.length >=
              this.calculateMaxSynapses(
                creature.input,
                creature.neurons.length - creature.input - creature.output,
                creature.output,
              )
          ) {
            continue;
          }
          break;
        case Mutation.SUB_NODE.name:
          if (creature.neurons.length <= creature.input + creature.output) {
            continue;
          }
          break;
        case Mutation.SWAP_NODES.name:
          if (creature.neurons.length <= creature.input + creature.output + 1) {
            continue;
          }
          break;
        case Mutation.ADD_BACK_CONN.name:
        case Mutation.SUB_BACK_CONN.name:
        case Mutation.ADD_SELF_CONN.name:
        case Mutation.SUB_SELF_CONN.name:
          if (feedbackLoop === false) {
            continue;
          }
          break;
      }

      return mutationMethod;
    }
  }

  /**
   * Mutate the creature using a specific method.
   *
   * @param {Object} method - The mutation method.
   * @param {string} method.name - The name of the mutation method.
   * @param {number[]} [focusList] - The list of focus indices.
   */
  public mutateCreature(
    creature: Creature,
    method: { name: string },
    focusList?: number[],
  ): boolean {
    assert(method.name, "Mutate name is required");
    const startUUID = CreatureUtil.makeUUID(creature);
    let mutator: RadioactiveInterface | undefined;
    switch (method.name) {
      case Mutation.ADD_NODE.name:
        mutator = new AddNeuron(creature);
        break;
      case Mutation.SUB_NODE.name:
        mutator = new SubNeuron(creature);
        break;
      case Mutation.ADD_CONN.name:
        mutator = new AddConnection(creature);
        break;
      case Mutation.SUB_CONN.name:
        mutator = new SubConnection(creature);
        break;
      case Mutation.MOD_WEIGHT.name:
        mutator = new ModWeight(creature);
        break;
      case Mutation.MOD_BIAS.name:
        mutator = new ModBias(creature);
        break;
      case Mutation.MOD_SQUASH.name:
        mutator = new ModSquash(creature);
        break;
      case Mutation.ADD_SELF_CONN.name:
        mutator = new AddSelfCon(creature);
        break;
      case Mutation.SUB_SELF_CONN.name:
        mutator = new SubSelfCon(creature);
        break;
      case Mutation.ADD_BACK_CONN.name:
        mutator = new AddBackCon(creature);
        break;
      case Mutation.SUB_BACK_CONN.name:
        mutator = new SubBackCon(creature);
        break;
      case Mutation.SWAP_NODES.name:
        mutator = new SwapNeurons(creature);
        break;
      default: {
        throw new Error("unknown: " + method);
      }
    }

    let changed = false;
    changed = mutator.mutate(focusList);

    if (!changed && (!focusList || focusList.length === 0)) {
      console.info(
        `${method.name} didn't mutate the creature. ${creature.input} observations, ${
          creature.neurons.length - creature.input - creature.output
        } neurons, ${creature.output} outputs, ${creature.synapses.length} synapses`,
      );
    }

    if (changed) {
      delete creature.uuid;
      creature.state.preparedNeurons = false;
      creature.fix();
    }
    if (creature.DEBUG) {
      creatureValidate(creature);
    }

    const endUUID = CreatureUtil.makeUUID(creature);
    if (startUUID === endUUID) {
      console.warn(
        `UUID didn't change after ${method.name} mutation, changed: ${changed}`,
      );
      return false;
    } else {
      return true;
    }
  }
}
