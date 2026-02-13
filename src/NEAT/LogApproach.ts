import { addTag, getTag } from "@stsoftware/tags/mod";
import type { Creature } from "../../mod.ts";
import { blue, bold, cyan } from "@std/fmt/colors";
import { assert } from "@std/assert";
import { getLogger } from "../utils/Logger.ts";

// Define a union type for the possible approaches
export type Approach =
  | "fine"
  | "trained"
  | "simplified"
  | "compact"
  | "backtrack"
  | "retry"
  | "discovery"
  | "discovered"
  | "discovery-replay";

export function logApproach(fittest: Creature, previous: Creature) {
  const fScoreTxt = getTag(fittest, "score");
  assert(fScoreTxt, "Fittest creature must have a score");
  const fScore = Number.parseFloat(fScoreTxt);

  const pScoreTxt = getTag(previous, "score");
  assert(pScoreTxt, "Previous creature must have a score");

  const pScore = Number.parseFloat(pScoreTxt);

  const approach = getTag(fittest, "approach") as Approach;
  if (approach) {
    const logged = getTag(fittest, "approach-logged");
    if (logged !== approach) {
      addTag(fittest, "approach-logged", approach);

      switch (approach) {
        case "fine": {
          const restored = getTag(previous, "restored");
          const restoredMsg = restored ? `Restored: ${restored}` : "";
          getLogger().info(
            "Fine tuning increased fitness by",
            fScore - pScore,
            "to",
            fScore,
            "adjusted",
            getTag(fittest, "adjusted"),
            restoredMsg,
          );
          break;
        }
        case "backtrack": {
          getLogger().info(
            "Backtracking increased fitness by",
            fScore - pScore,
            "to",
            fScore,
            "adjusted",
            getTag(fittest, "adjusted"),
          );
          break;
        }
        case "simplified": {
          getLogger().info(
            "Simplifying improved by",
            fScore - pScore,
            "to",
            fScore,
          );
          break;
        }
        case "retry": {
          getLogger().info(
            "Retrying increased fitness by",
            fScore - pScore,
            "to",
            fScore,
            "adjusted",
            getTag(fittest, "adjusted"),
          );
          break;
        }
        case "trained": {
          const trainID = getTag(fittest, "trainID");
          getLogger().info(
            bold(cyan("Training")),
            blue(`${trainID}`),
            "increased fitness by",
            fScore - pScore,
            "to",
            fScore,
          );
          break;
        }
        case "discovery":
        case "discovered":
        case "discovery-replay": {
          const discoveryID = getTag(fittest, "discoveryID");
          const evaluation = getTag(fittest, "Discovery") ??
            getTag(fittest, "discovery");

          getLogger().info(
            bold(cyan("Discovery")),
            blue(`${discoveryID}`),
            evaluation ?? cyan("unknown"),
            "increased fitness by",
            fScore - pScore,
            "to",
            fScore,
          );
          break;
        }
        case "compact": {
          const oldNeuronsTxt = getTag(fittest, "old-neurons");
          assert(oldNeuronsTxt, "Old neurons must be defined");
          const oldNeurons = Number.parseInt(oldNeuronsTxt);
          getLogger().info(
            "Compacting increased fitness by",
            fScore - pScore,
            "to",
            fScore,
            `neurons: ${
              fittest.neurons.length - fittest.input - fittest.output
            } was:`,
            oldNeurons,
            `synapses: ${fittest.synapses.length} was:`,
            getTag(fittest, "old-synapses"),
          );
          break;
        }
        default: {
          throw new Error(`Unknown approach '${approach}'`);
        }
      }
    }
  }
}
