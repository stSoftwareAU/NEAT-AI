import { assertThrows } from "@std/assert";
import { TopologyError } from "@errors/TopologyError.ts";
import { selectWeightedIndex } from "@predictiveCoding/PredictionErrorGuidedMutation.ts";

Deno.test("selectWeightedIndex throws TopologyError for empty candidates", () => {
  assertThrows(
    () => selectWeightedIndex([], new Map()),
    TopologyError,
    "no candidates provided",
  );
});
