import { addTag, getTag } from "@stsoftware/tags";
import type { Creature } from "../../mod.ts";
import { blue, bold, cyan } from "@std/fmt/colors";
import { assert } from "@std/assert";

// Define a union type for the possible approaches
export type Approach =
  | "fine"
  | "trained"
  | "compact"
  | "graft"
  | "backtrack"
  | "retry";

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
          console.info(
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
          console.info(
            "Backtracking increased fitness by",
            fScore - pScore,
            "to",
            fScore,
            "adjusted",
            getTag(fittest, "adjusted"),
          );
          break;
        }
        case "retry": {
          console.info(
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
          console.info(
            bold(cyan("Training")),
            blue(`${trainID}`),
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
          const oldNeurons = Number.parseInt(oldNeuronsTxt) -
            fittest.input - fittest.output;
          console.info(
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
        case "graft": {
          console.info(
            "Learnings increased fitness by",
            fScore - pScore,
            "to",
            fScore,
            `nodes: ${fittest.neurons.length} was:`,
            getTag(fittest, "old-neurons"),
            `connections: ${fittest.synapses.length} was:`,
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
