import { removeTag } from "@stsoftware/tags";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import { type Creature, Mutation } from "../../mod.ts";
import type { CreatureInternal } from "../architecture/CreatureInterfaces.ts";
import type { NeatConfig } from "../config/NeatConfig.ts";

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
        for (let j = this.config.mutationAmount; j--;) {
          const mutationMethod = this.selectMutationMethod(creature);

          creature.mutate(
            mutationMethod,
            Math.random() < this.config.focusRate
              ? this.config.focusList
              : undefined,
          );
        }

        if (this.config.debug) {
          creatureValidate(creature);
        }

        removeTag(creature, "approach");
        removeTag(creature, "approach-logged");
      }
    }
  }

  /**
   * Selects a random mutation method for a genome according to the parameters
   */
  private selectMutationMethod(creature: CreatureInternal) {
    const mutationMethods = this.config
      .mutation;

    for (let attempts = 0; true; attempts++) {
      const mutationMethod = mutationMethods[
        Math.floor(Math.random() * this.config.mutation.length)
      ];

      if (
        mutationMethod === Mutation.ADD_NODE &&
        creature.neurons.length >= this.config.maximumNumberOfNodes
      ) {
        continue;
      }

      if (
        mutationMethod === Mutation.ADD_CONN &&
        creature.synapses.length >= this.config.maxConns
      ) {
        continue;
      }

      return mutationMethod;
    }
  }
}
