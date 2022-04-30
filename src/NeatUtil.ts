import { Neat } from "./neat.js";
import { NetworkInterface } from "./architecture/NetworkInterface.ts";

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
