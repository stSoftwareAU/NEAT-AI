import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { compactCreature } from "@compact/CompactCreature.ts";
import { calculate } from "@architecture/Score.ts";
import { initWasmForTests } from "../_initWasm.ts";

// Issue #3034: safe constant fold — fold `type:"constant"` neurons into their
// additive (non-aggregate) consumers' biases and drop the folded synapses.
//
// Both fixtures are trimmed subgraphs vendored from the production creature
// cited in #3029 (kept tiny so the assertions stay legible). Behaviour must be
// preserved to ~1e-6 and the score must not regress.

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

function loadFixture(path: string): CreatureExport {
  return JSON.parse(Deno.readTextFileSync(path)) as CreatureExport;
}

Deno.test(
  "compactCreature folds a constant into its sole HARD_TANH consumer and removes it (full removal)",
  async () => {
    await initWasmForTests();

    // legacy-neuron-1762683495 (constant 0.5) --w0.5--\
    //                                                   533d8616… (HARD_TANH) --> output-0
    // input-0 (varying) -----------------------w0.7---/
    //
    // HARD_TANH is not an aggregation squash, so the constant's fixed
    // contribution (0.5 * 0.5) folds into the HARD_TANH bias and the synapse is
    // dropped. The constant then has no outbound synapses and is removed
    // entirely. The HARD_TANH neuron survives because it still has a varying
    // input.
    const json = loadFixture("test/data/constant-fold-full-removal.json");

    const creature = Creature.fromJSON(json, false);
    creature.validate();

    const data = makeData(creature.input);

    const compacted = compactCreature(creature, false);
    assert(compacted !== undefined, "should have compacted");
    creatureValidate(compacted!, { forwardOnly: true });

    const neurons = compacted!.neurons;

    // Constant folded away entirely.
    assertEquals(
      neurons.some((n) => n.uuid === "legacy-neuron-1762683495"),
      false,
      "constant neuron should be removed once it has no outbound synapses",
    );

    // HARD_TANH consumer retained with an updated bias.
    const consumer = neurons.find(
      (n) => n.uuid === "533d8616-037c-4278-b95c-3a2a1ce15ee6",
    );
    assert(
      consumer,
      "HARD_TANH consumer must be retained (has a varying input)",
    );
    // Folded bias: 0.2 + (0.5 * 0.5) = 0.45
    assertAlmostEquals(consumer!.bias, 0.45, 1e-9);

    // The folded synapse is gone.
    const exported = compacted!.exportJSON();
    assertEquals(
      exported.synapses.some(
        (s) => s.fromUUID === "legacy-neuron-1762683495",
      ),
      false,
      "the folded constant synapse should be dropped",
    );

    assertOutputsPreserved(creature, compacted!, data, creature.output);

    const beforeScore = calculate(creature, 0, GROWTH_COST);
    const afterScore = calculate(compacted!, 0, GROWTH_COST);
    assert(
      afterScore >= beforeScore - 1e-9,
      `score regressed: before ${beforeScore}, after ${afterScore}`,
    );
  },
);

Deno.test(
  "compactCreature partially folds a constant: drops non-IF synapses, keeps the IF synapse (partial fold)",
  async () => {
    await initWasmForTests();

    // neuron-132866057 (constant 0.5) --w0.4--> nonif-consumer (HARD_TANH) --> output-0
    //                  \---- "positive" w0.3 --> if-consumer (IF) ----------> output-0
    //
    // The constant feeds both an aggregate IF consumer and a non-aggregate
    // HARD_TANH consumer. Only the non-IF synapse may be folded; the IF synapse
    // is left untouched, so the constant is retained for the IF consumer.
    const json = loadFixture("test/data/constant-fold-partial-if.json");

    const creature = Creature.fromJSON(json, false);
    creature.validate();

    const data = makeData(creature.input);

    const compacted = compactCreature(creature, false);
    assert(compacted !== undefined, "should have compacted");
    creatureValidate(compacted!, { forwardOnly: true });

    const neurons = compacted!.neurons;
    const exported = compacted!.exportJSON();

    // Constant retained because the IF consumer still references it.
    assertEquals(
      neurons.some((n) => n.uuid === "neuron-132866057"),
      true,
      "constant must be retained while an aggregate consumer references it",
    );

    // The IF synapse is kept.
    assertEquals(
      exported.synapses.some(
        (s) => s.fromUUID === "neuron-132866057" && s.toUUID === "if-consumer",
      ),
      true,
      "the synapse into the IF (aggregate) consumer must be kept",
    );

    // The non-IF synapse is folded away.
    assertEquals(
      exported.synapses.some(
        (s) =>
          s.fromUUID === "neuron-132866057" && s.toUUID === "nonif-consumer",
      ),
      false,
      "the synapse into the non-aggregate consumer must be folded away",
    );

    // Non-IF consumer bias updated: 0.1 + (0.4 * 0.5) = 0.3
    const nonIf = neurons.find((n) => n.uuid === "nonif-consumer");
    assert(
      nonIf,
      "non-aggregate consumer must be retained (has a varying input)",
    );
    assertAlmostEquals(nonIf!.bias, 0.3, 1e-9);

    assertOutputsPreserved(creature, compacted!, data, creature.output);

    const beforeScore = calculate(creature, 0, GROWTH_COST);
    const afterScore = calculate(compacted!, 0, GROWTH_COST);
    assert(
      afterScore >= beforeScore - 1e-9,
      `score regressed: before ${beforeScore}, after ${afterScore}`,
    );
  },
);
