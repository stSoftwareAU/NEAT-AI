import { assertAlmostEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureErrorImpactEstimator } from "../../src/discovery/NeuronErrorImpactEstimator.ts";

// Integer IDs for neurons (deterministicIdFromUuid or fixed scheme).
// Input neurons: id = inputIndex (0, 1, ...)
// Output neurons: id = -(outputIndex + 1) (-1, -2, ...)
// Hidden neurons: deterministicIdFromUuid
const HIDDEN_A_ID = 1775329602; // "hidden-a"
const HIDDEN_B_ID = 1775329601; // "hidden-b"
const HIDDEN_C_ID = 1775329600; // "hidden-c"
const INPUT_0_ID = 0;
const INPUT_1_ID = 1;
const OUTPUT_0_ID = -1;

Deno.test("NeuronErrorImpactEstimator splits share across inbound synapses", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-b", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 0.5 },
      { fromUUID: "input-1", toUUID: "hidden-b", weight: 0.5 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 1 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: 1 },
    ],
  });
  creature.validate();

  const estimator = new CreatureErrorImpactEstimator(creature);
  const shareHiddenA = estimator.getNeuronShare(HIDDEN_A_ID);
  const shareHiddenB = estimator.getNeuronShare(HIDDEN_B_ID);
  const shareOutput = estimator.getNeuronShare(OUTPUT_0_ID);

  assertAlmostEquals(shareOutput, 1, 1e-6);
  assertAlmostEquals(shareHiddenA, 0.5, 1e-6);
  assertAlmostEquals(shareHiddenB, 0.5, 1e-6);
});

Deno.test("NeuronErrorImpactEstimator propagates recursively through multiple layers", () => {
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-b", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-c", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 2 },
      { fromUUID: "input-1", toUUID: "hidden-a", weight: 1 },
      { fromUUID: "hidden-a", toUUID: "hidden-b", weight: 1 },
      { fromUUID: "hidden-a", toUUID: "hidden-c", weight: 1 },
      { fromUUID: "hidden-b", toUUID: "output-0", weight: 1 },
      { fromUUID: "hidden-c", toUUID: "output-0", weight: 1 },
    ],
  });
  creature.validate();

  const estimator = new CreatureErrorImpactEstimator(creature);

  // hidden-b and hidden-c split the output share (0.5 each)
  assertAlmostEquals(
    estimator.getNeuronShare(HIDDEN_B_ID),
    0.5,
    1e-6,
  );
  assertAlmostEquals(
    estimator.getNeuronShare(HIDDEN_C_ID),
    0.5,
    1e-6,
  );
  // hidden-a feeds both hidden-b and hidden-c, so it accumulates their shares
  assertAlmostEquals(
    estimator.getNeuronShare(HIDDEN_A_ID),
    1,
    1e-6,
  );
  // Inputs split hidden-a share proportional to absolute weights 2:1
  assertAlmostEquals(
    estimator.getNeuronShare(INPUT_0_ID),
    2 / 3,
    1e-6,
  );
  assertAlmostEquals(
    estimator.getNeuronShare(INPUT_1_ID),
    1 / 3,
    1e-6,
  );
});

Deno.test("NeuronErrorImpactEstimator averages contribution across multiple outputs", () => {
  const creature = Creature.fromJSON({
    input: 1,
    output: 2,
    neurons: [
      { type: "hidden", uuid: "hidden-a", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-1", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-a", weight: 1 },
      { fromUUID: "hidden-a", toUUID: "output-0", weight: 1 },
      { fromUUID: "hidden-a", toUUID: "output-1", weight: 1 },
    ],
  });
  creature.validate();

  const estimator = new CreatureErrorImpactEstimator(creature);

  // Each output starts with share 0.5, so hidden-a accumulates 1.0 across both
  assertAlmostEquals(
    estimator.getNeuronShare(HIDDEN_A_ID),
    1,
    1e-6,
  );
  // Input inherits the hidden share because it is the only inbound connection
  assertAlmostEquals(
    estimator.getNeuronShare(INPUT_0_ID),
    1,
    1e-6,
  );
});
