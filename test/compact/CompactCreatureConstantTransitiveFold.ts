import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { compactCreature } from "@compact/CompactCreature.ts";
import { calculate } from "@architecture/Score.ts";
import { initWasmForTests } from "../_initWasm.ts";

const GROWTH_COST = 0.0001;

function makeData(inputs: number): number[][] {
  const data: number[][] = [];
  for (let i = 500; i--;) {
    const row: number[] = [];
    for (let j = 0; j < inputs; j++) {
      row.push(Math.random() * 2 - 1);
    }
    data.push(row);
  }
  return data;
}

function assertOutputsPreserved(
  before: Creature,
  after: Creature,
  data: number[][],
  output: number,
) {
  for (const row of data) {
    const expected = before.activate(new Float32Array(row), false);
    const actual = after.activate(new Float32Array(row), false);
    for (let o = 0; o < output; o++) {
      assertAlmostEquals(
        actual[o],
        expected[o],
        0.000_001,
        `output ${o}: actual ${actual[o]}, expected ${expected[o]}`,
      );
    }
  }
}

Deno.test(
  "compactCreature collapses a constant -> hidden -> output subgraph to a fixpoint",
  async () => {
    await initWasmForTests();

    // input-0 (varying) -----------------------------> output-0
    // const-c (0.5) --w0.5--> hidden-h (LOGISTIC) --w0.5--> output-0
    //
    // Folding const-c into hidden-h leaves hidden-h with zero varying inputs,
    // which then collapses into output-0. The whole constant-only chain should
    // disappear while output-0 keeps its genuinely varying input.
    const json: CreatureExport = {
      semanticVersion: "4.0.0",
      forwardOnly: true,
      input: 1,
      output: 1,
      neurons: [
        { type: "constant", uuid: "const-c", bias: 0.5 },
        { type: "hidden", uuid: "hidden-h", squash: "LOGISTIC", bias: 0.2 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      ],
      synapses: [
        { fromUUID: "const-c", toUUID: "hidden-h", weight: 0.5 },
        { fromUUID: "hidden-h", toUUID: "output-0", weight: 0.5 },
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.6 },
      ],
    };

    const creature = Creature.fromJSON(json, false);
    creature.validate();

    const data = makeData(1);

    const compacted = compactCreature(creature, false);
    assert(compacted !== undefined, "should have compacted");
    creatureValidate(compacted!, { forwardOnly: true });

    // The whole constant-only subgraph collapsed.
    assertEquals(
      compacted!.neurons.some((n) => n.uuid === "const-c"),
      false,
      "constant neuron should be folded away",
    );
    assertEquals(
      compacted!.neurons.some((n) => n.uuid === "hidden-h"),
      false,
      "constant-fed hidden neuron should collapse",
    );

    assertOutputsPreserved(creature, compacted!, data, 1);

    // Score must be equal-or-higher (fewer neurons/synapses, identical output).
    const beforeScore = calculate(creature, 0, GROWTH_COST);
    const afterScore = calculate(compacted!, 0, GROWTH_COST);
    assert(
      afterScore >= beforeScore - 1e-9,
      `score regressed: before ${beforeScore}, after ${afterScore}`,
    );
  },
);

Deno.test(
  "compactCreature does NOT collapse a hidden neuron with a varying input",
  async () => {
    await initWasmForTests();

    // const-c (0.4) --w0.5--\
    //                         hidden-h (LOGISTIC) --w0.5--> output-0
    // input-0 (varying) --w0.7--/
    //
    // hidden-h has a genuinely varying input, so it is NEVER constant and must
    // survive compaction (the constant input may still be folded into its bias).
    const json: CreatureExport = {
      semanticVersion: "4.0.0",
      forwardOnly: true,
      input: 1,
      output: 1,
      neurons: [
        { type: "constant", uuid: "const-c", bias: 0.4 },
        { type: "hidden", uuid: "hidden-h", squash: "LOGISTIC", bias: 0.2 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0.1 },
      ],
      synapses: [
        { fromUUID: "const-c", toUUID: "hidden-h", weight: 0.5 },
        { fromUUID: "input-0", toUUID: "hidden-h", weight: 0.7 },
        { fromUUID: "hidden-h", toUUID: "output-0", weight: 0.5 },
      ],
    };

    const creature = Creature.fromJSON(json, false);
    creature.validate();

    const data = makeData(1);

    const compacted = compactCreature(creature, false);

    // Compaction may fold the constant input into the hidden bias, but the
    // hidden neuron itself must remain because it has a varying input.
    const result = compacted ?? creature;
    creatureValidate(result, { forwardOnly: true });
    assertEquals(
      result.neurons.some((n) => n.uuid === "hidden-h"),
      true,
      "hidden neuron with a varying input must not be collapsed",
    );

    assertOutputsPreserved(creature, result, data, 1);
  },
);
