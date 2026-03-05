import { assertThrows } from "@std/assert";
import { TopologyError } from "../../src/errors/TopologyError.ts";
import {
  calculateSquashError,
  findCandidateSquash,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverSquashAnalysis.ts";
import { makeSimpleCreature } from "../fixtures/SimpleCreatures.ts";

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
        "hidden-1",
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
        "hidden-1",
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
