import { Neat } from "./Neat.js";

import { Network } from "./architecture/network.js";

import { NetworkUtil } from "./architecture/NetworkUtil.ts";
import { NetworkInterface } from "./architecture/NetworkInterface.ts";
import { Mutation } from "./methods/mutation.ts";
import { crypto } from "https://deno.land/std@0.161.0/crypto/mod.ts";
import { encode } from "https://deno.land/std@0.161.0/encoding/base64.ts";
import { ensureDirSync } from "https://deno.land/std@0.161.0/fs/ensure_dir.ts";
import { NeatConfig } from "./config/NeatConfig.ts";
import { removeTag } from "../src/tags/TagsInterface.ts";

const TE = new TextEncoder();

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
    if (typeof creature !== "object") {
      console.trace();
      throw "Not an object was: " + (typeof creature);
    }

    const json = (creature as Network).util.toJSON();
    delete json.tags;

    const txt = JSON.stringify(json);

    const arrayBuffer = await crypto.subtle.digest(
      "SHA-256",
      TE.encode(txt),
    );
    const b64 = encode(arrayBuffer);
    const name = b64.replaceAll("=", "").replaceAll("/", "-").replaceAll(
      "+",
      "_",
    );

    return name;
  }

  previousExperiment(key: string) {
    if (this.config.experimentStore) {
      const filePath = this.config.experimentStore + "/score/" +
        key.substring(0, 3) + "/" + key.substring(3) + ".txt";
      try {
        Deno.statSync(filePath);

        return true;
      } catch (error) {
        if (error instanceof Deno.errors.NotFound) {
          // file or directory does not exist
          return false;
        } else {
          // unexpected error, maybe permissions, pass it along
          throw error;
        }
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

        Deno.writeTextFileSync(filePath, sTxt);
      }
    }
  }

  /**
   * Mutates the given (or current) population
   */
  mutate(creatures: NetworkInterface[]) {
    for (let i = creatures.length; i--;) {
      if (Math.random() <= this.config.mutationRate) {
        const creature = creatures[i] as Network;
        if (this.config.debug) {
          creature.util.validate();
        }
        for (let j = this.config.mutationAmount; j--;) {
          const mutationMethod = this.selectMutationMethod(creature);

          creature.util.mutate(
            mutationMethod,
            Math.random() < this.config.focusRate
              ? this.config.focusList
              : undefined,
          );
        }

        if (this.config.debug) {
          creature.util.validate();
        }

        removeTag(creature, "approach");
      }
    }
  }

  /**
   * Create the initial pool of genomes
   */
  async populatePopulation(network: Network) {
    if (!network) {
      throw "Network mandatory";
    }

    if (this.config.debug) {
      network.util.validate();
    }
    while (this.neat.population.length < this.config.popSize - 1) {
      const clonedCreature = NetworkUtil.fromJSON(
        network.util.toJSON(),
        this.config.debug,
      );
      const creatures = [clonedCreature];
      this.mutate(creatures);
      this.neat.population.push(creatures[0]);
    }

    this.neat.population.unshift(network);

    await this.deDuplicate(this.neat.population);
  }

  /**
   * Breeds two parents into an offspring, population MUST be sorted
   */
  getOffspring() {
    const p1 = this.neat.getParent();

    if (p1 === undefined) {
      console.warn(
        "No parent 1 found",
        this.config.selection.name,
        this.neat.population.length,
      );

      for (let pos = 0; pos < this.neat.population.length; pos++) {
        console.info(pos, this.neat.population[pos] ? true : false);
      }
      for (let pos = 0; pos < this.neat.population.length; pos++) {
        if (this.neat.population[pos]) return this.neat.population[pos];
      }
      throw "Extinction event";
    }

    let p2 = this.neat.getParent();
    for (let i = 0; i < 12; i++) {
      p2 = this.neat.getParent();
      if (p1 !== p2) break;
    }

    if (p2 === undefined) {
      console.warn(
        "No parent 2 found",
        this.config.selection.name,
        this.neat.population.length,
      );

      for (let pos = 0; pos < this.neat.population.length; pos++) {
        console.info(pos, this.neat.population[pos] ? true : false);
      }
      for (let pos = 0; pos < this.neat.population.length; pos++) {
        if (this.neat.population[pos]) return this.neat.population[pos];
      }

      throw "Extinction event";
    }

    const creature = NetworkUtil.crossOver(
      p1,
      p2,
    );
    if (this.config.debug) creature.util.validate();
    return creature;
  }

  async deDuplicate(creatures: NetworkInterface[]) {
    if (creatures.length > this.config.popSize + 1) {
      console.info(
        `Over populated ${creatures.length} expected ${this.config.popSize}`,
      );
    }

    const unique = new Set();
    /**
     *  Reset the scores & de-duplicate the population.
     */
    for (let i = 0; i < creatures.length; i++) {
      const p = creatures[i];
      const key = await this.makeUniqueName(p);

      let duplicate = unique.has(key);
      if (!duplicate && i > this.config.elitism) {
        duplicate = this.previousExperiment(key);
      }
      if (duplicate) {
        if (creatures.length > this.config.popSize) {
          console.info(
            `Culling duplicate creature at ${i} of ${creatures.length}`,
          );
          creatures.splice(i, 1);
          i--;
        } else {
          for (let j = 0; j < 100; j++) {
            const tmpPopulation = [this.getOffspring()];
            this.mutate(tmpPopulation);

            const p2 = tmpPopulation[0];
            const key2 = await this.makeUniqueName(p2);

            let duplicate2 = unique.has(key2);
            if (!duplicate2 && i > this.config.elitism) {
              duplicate2 = await this.previousExperiment(key2);
            }
            if (duplicate2 == false) {
              creatures[i] = p2;
              unique.add(key2);
              break;
            }
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

    for (let attempts = 0; true; attempts++) {
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

      return mutationMethod;
    }
  }
}
