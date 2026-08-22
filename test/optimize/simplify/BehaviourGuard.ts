import { assert, assertEquals } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { simplify } from "@optimize/Simplify.ts";
import {
  isExactBehaviourPreserved,
  measureBehaviourDeviation,
} from "@architecture/BehaviourGuard.ts";
import { initWasmForTests } from "../../_initWasm.ts";

/**
 * Issue #3840: `simplify()` is documented as folding structure "without
 * changing what the creature computes", and the creature it returns is pushed
 * straight into the elitists carrying an `approach: simplified` tag. Nothing
 * verified the claim.
 *
 * The fixture below is a real violation: an ABSOLUTE neuron whose inputs are
 * all non-negative is bypassed as though it were an identity, but that neuron
 * feeds an `IF` **condition**. The bypass synapse loses the condition role, so
 * the branch the creature takes changes completely.
 */

/** input → gate (LOGISTIC) → sign (ABSOLUTE) → IF condition → output. */
function absoluteIntoIfCondition(): CreatureExport {
  return {
    input: 2,
    output: 1,
    neurons: [
      { type: "constant", uuid: "const-one", bias: 1 },
      { type: "hidden", uuid: "gate", squash: "LOGISTIC", bias: 0 },
      { type: "hidden", uuid: "sign", squash: "ABSOLUTE", bias: 0 },
      { type: "hidden", uuid: "branch", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "gate", weight: 1 },
      { fromUUID: "gate", toUUID: "sign", weight: 1 },
      { fromUUID: "sign", toUUID: "branch", weight: 1, type: "condition" },
      { fromUUID: "const-one", toUUID: "branch", weight: -0.75, type: "condition" },
      { fromUUID: "input-1", toUUID: "branch", weight: 1, type: "positive" },
      { fromUUID: "const-one", toUUID: "branch", weight: 0.25, type: "negative" },
      { fromUUID: "branch", toUUID: "output-0", weight: 1 },
    ],
  };
}

Deno.test("simplify never returns a creature that changed behaviour", async () => {
  await initWasmForTests();

  const creature = Creature.fromJSON(absoluteIntoIfCondition(), false);
  const simplified = simplify(creature);

  if (simplified) {
    const deviation = measureBehaviourDeviation(creature, simplified);
    assert(
      isExactBehaviourPreserved(deviation),
      `simplify changed the outputs: worst delta ${deviation.worstDelta}`,
    );
  }
});

Deno.test("simplify still folds a creature it can simplify exactly", async () => {
  await initWasmForTests();

  // A redundant IDENTITY neuron with a zero bias splices out exactly.
  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "pass-through", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "pass-through", weight: 1.25 },
      { fromUUID: "pass-through", toUUID: "output-0", weight: 0.8 },
    ],
  };

  const creature = Creature.fromJSON(json, false);
  const simplified = simplify(creature);

  assert(simplified, "an exact simplification must still be accepted");
  const deviation = measureBehaviourDeviation(creature, simplified);
  assert(
    isExactBehaviourPreserved(deviation),
    `accepted simplification changed the outputs: ${deviation.worstDelta}`,
  );
});

Deno.test("simplify carries the creature's provenance tags", async () => {
  await initWasmForTests();

  const json: CreatureExport = {
    input: 1,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "pass-through", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "pass-through", weight: 1.25 },
      { fromUUID: "pass-through", toUUID: "output-0", weight: 0.8 },
    ],
  };

  const creature = Creature.fromJSON(json, false);
  addTag(creature, "trainID", "T-3840");
  addTag(creature, "error", "0.6310");

  const simplified = simplify(creature);
  assert(simplified, "the fixture must simplify");

  assertEquals(
    getTag(simplified, "trainID"),
    "T-3840",
    "provenance must survive simplification",
  );
  assertEquals(
    getTag(simplified, "error"),
    "0.6310",
    "the source error must survive simplification",
  );
  assertEquals(
    getTag(simplified, "approach"),
    "simplified",
    "the pass must still name itself",
  );
});
