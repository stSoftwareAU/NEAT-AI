import { Neat } from "./neat.js";
import { NetworkInterface } from "./architecture/NetworkInterface.ts";
import { Mutation } from "./methods/mutation.ts";
import { crypto } from "https://deno.land/std@0.137.0/crypto/mod.ts";
import { encode } from "https://deno.land/std@0.137.0/encoding/base64.ts";
import { ensureDirSync } from "https://deno.land/std@0.137.0/fs/ensure_dir.ts";
import { NeatConfig } from "./config/NeatConfig.ts";
import { removeTag } from "../src/tags/TagsInterface.ts";

export class NeatUtil {
  private neat;
  private config;
  constructor(
    neat: Neat,
    config: NeatConfig,
  ) {
    this.neat = neat;
    this.config = config;
  }

  async makeUniqueName(creature: NetworkInterface) {
    const json = creature.toJSON();
    delete json.tags;

    const txt = JSON.stringify(json, null, 1);

    const b64 = encode(
      new Uint8Array(
        await crypto.subtle.digest(
          "SHA-256",
          new TextEncoder().encode(txt),
        ),
      ),
    );
    const name = b64.replaceAll("=", "").replaceAll("/", "-").replaceAll(
      "+",
      "_",
    );

    return name;
  }

  async previousExperiment(creature: NetworkInterface) {
    if (this.config.experimentStore) {
      const name = await this.makeUniqueName(creature);

      const filePath = this.config.experimentStore + "/score/" +
        name.substring(0, 3) + "/" + name.substring(3) + ".txt";
      try {
        Deno.readTextFileSync(filePath);
        // console.log("PREVIOUS", name, score);
        return true;
      } catch {
        return false;
      }
    } else {
      return false;
    }
  }

  async writeScores(creatures: NetworkInterface[]) {
    if (this.config.experimentStore) {
      for (let i = creatures.length; i--;) {
        const creature = creatures[i];

        const name = await this.makeUniqueName(creature);
        ensureDirSync(
          this.config.experimentStore + "/score/" +
            name.substring(0, 3),
        );
        const filePath = this.config.experimentStore + "/score/" +
          name.substring(0, 3) + "/" +
          name.substring(3) + ".txt";
        const sTxt = creature.score ? creature.score.toString() : "unknown";

        await Deno.writeTextFile(filePath, sTxt);
      }
    }
  }

  /**
   * Mutates the given (or current) population
   */
  mutate(creatures: NetworkInterface[]) {
    for (let i = creatures.length; i--;) {
      if (Math.random() <= this.config.mutationRate) {
        const creature = creatures[i];
        for (let j = this.config.mutationAmount; j--;) {
          const mutationMethod = this.selectMutationMethod(creature);
          if (creature.mutate) {
            creature.mutate(mutationMethod);
          }
        }
        removeTag(creature, "approach");
      }
    }
  }

  async deDepulate(creatures: NetworkInterface[]) {
    const unique = new Set();
    /**
     *  Reset the scores & de-duplcate the population.
     */
    for (let i = 0; i < creatures.length; i++) {
      const p = creatures[i];
      const key = await this.makeUniqueName(p);

      let duplicate = unique.has(key);
      if (!duplicate && i > this.config.elitism) {
        duplicate = await this.previousExperiment(p);
      }
      if (duplicate) {
        for (let j = 0; j < 100; j++) {
          const tmpPopulation = [this.neat.getOffspring()];
          this.mutate(tmpPopulation);

          const p2 = tmpPopulation[0];
          const key2 = await this.makeUniqueName(p2);

          let duplicate2 = unique.has(key2);
          if (!duplicate2 && i > this.config.elitism) {
            duplicate2 = await this.previousExperiment(p2);
          }
          if (duplicate2 == false) {
            creatures[i] = p2;
            unique.add(key2);
            break;
          }
        }
      } else {
        unique.add(key);
      }
    }
  }

  /**
   * Selects a random mutation method for a genome according to the parameters
   */
  selectMutationMethod(creature: NetworkInterface) {
    const mutationMethods = this.config
      .mutation;

    for (let attempts = 0; attempts < 3; attempts++) {
      const mutationMethod = mutationMethods[
        Math.floor(Math.random() * this.config.mutation.length)
      ];

      if (
        mutationMethod === Mutation.ADD_NODE &&
        creature.nodes.length >= this.config.maxNodes
      ) {
        continue;
      }

      if (
        mutationMethod === Mutation.ADD_CONN &&
        creature.connections.length >= this.config.maxConns
      ) {
        continue;
      }

      if (
        mutationMethod === Mutation.ADD_GATE &&
        creature.gates &&
        creature.gates.length >= this.config.maxGates
      ) {
        continue;
      }

      return mutationMethod;
    }
  }
}
