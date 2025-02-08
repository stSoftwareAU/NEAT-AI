import { removeTag } from "@stsoftware/tags";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import { Creature, Mutation } from "../../mod.ts";
import type { NeatConfig } from "../config/NeatConfig.ts";
import { discover } from "../blackbox/Discover.ts";
import { memeticUpdate } from "../blackbox/MemeticUpdate.ts";

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
        if (this.config.debug) {
          creatureValidate(creature);
        }
        let original: Creature | undefined;
        if (creature.score !== undefined) {
          original = Creature.fromJSON(creature.exportJSON());
          original.score = creature.score;
        }
        let changed = false;
        for (let j = this.config.mutationAmount; j--;) {
          const mutationMethod = this.selectMutationMethod(creature);

          const flag = creature.mutate(
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
        Math.floor(Math.random() * this.config.mutation.length)
      ];

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
}
