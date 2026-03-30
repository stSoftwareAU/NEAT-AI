import { assertThrows } from "@std/assert";
import { TopologyError } from "@errors/TopologyError.ts";
import {
  calculateSquashError,
  findCandidateSquash,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverSquashAnalysis.ts";
import { makeSimpleCreature } from "../fixtures/SimpleCreatures.ts";

// Integer ID for hidden-1 in makeSimpleCreature (explicit id in fixture).
const HIDDEN_1_ID = 5001;

Deno.test("calculateSquashError throws TopologyError when activation is undefined", () => {
  assertThrows(
    () =>
      calculateSquashError(
        [1.0, 2.0],
        [undefined as unknown as number, 0.5],
      ),
    TopologyError,
    "Activation is undefined",
  );
});

Deno.test("findCandidateSquash throws TopologyError when record value is undefined", () => {
  const creature = makeSimpleCreature();

  assertThrows(
    () =>
      findCandidateSquash(
        creature,
        HIDDEN_1_ID,
        [{
          activation: 0.5,
          value: undefined as unknown as number,
          errors: [0.1],
        }],
        () => 1.0,
        false,
        () => {},
      ),
    TopologyError,
    "Value is undefined",
  );
});

Deno.test("findCandidateSquash throws TopologyError when record activation is undefined", () => {
  const creature = makeSimpleCreature();

  assertThrows(
    () =>
      findCandidateSquash(
        creature,
        HIDDEN_1_ID,
        [{
          activation: undefined as unknown as number,
          value: 0.5,
          errors: [0.1],
        }],
        () => 1.0,
        false,
        () => {},
      ),
    TopologyError,
    "Activation is undefined",
  );
});
