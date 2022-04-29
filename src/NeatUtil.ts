import { Neat } from "./neat.js";
import { NetworkInterface } from "./architecture/NetworkInterface.ts";

import { crypto } from "https://deno.land/std@0.137.0/crypto/mod.ts";
import { encode } from "https://deno.land/std@0.137.0/encoding/base64.ts";
import { ensureDirSync } from "https://deno.land/std@0.137.0/fs/ensure_dir.ts";
import { NeatConfig } from "./config.ts";
import { removeTag } from "../src/tags/TagsInterface.ts";

const EXPERIMENTS_DIR = "/experiments";

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
    const name =
      b64.replaceAll("=", "").replaceAll("/", "").replaceAll("+", "_") +
      ".json";

    return name;
  }

  async previousExperiment(creature: NetworkInterface) {
    if (this.config.creatureStore) {
      const name = await this.makeUniqueName(creature);

      const filePath = this.config.creatureStore + EXPERIMENTS_DIR + "/" +
        name.substring(0, 3) + "/" + name.substring(3);
      try {
        const score = Deno.readTextFileSync(filePath);
        console.log("PREVIOUS", name, score);
        return true;
      } catch {
        return false;
      }
    }
  }

  async writeExperiments(creatures: NetworkInterface[]) {
    if (this.config.creatureStore) {
      for (let i = creatures.length; i--;) {
        const creature = creatures[i];

        const name = await this.makeUniqueName(creature);
        ensureDirSync(
          this.config.creatureStore + "/" + EXPERIMENTS_DIR + "/" +
            name.substring(0, 3),
        );
        const filePath = this.config.creatureStore + "/" + EXPERIMENTS_DIR +
          "/" +
          name.substring(0, 3) + "/" +
          name.substring(4);
        const sTxt = creature.score ? creature.score.toString() : "unknown";
        // try {
        await Deno.writeTextFile(filePath, sTxt);
        // } catch (e) {
        //   console.warn(e);
        // }
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
          const mutationMethod = this.neat.selectMutationMethod(creature);
          if (creature.mutate) {
            creature.mutate(mutationMethod);
          }
        }
        removeTag(creature, "approach");
      }
    }
  }
}
