import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { compactCreature } from "@compact/CompactCreature.ts";
import { calculate } from "@architecture/Score.ts";
import { initWasmForTests } from "../_initWasm.ts";

// Issue #3036: exact IF-collapse for the safe compaction variant. When every
// condition-type input of an IF neuron is constant, the selector is fixed at
// compaction time, so the IF collapses losslessly to its always-taken branch as
// a plain additive (IDENTITY) neuron. Behaviour must be preserved to ~1e-6 and
// the score must not regress.

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
  "compactCreature collapses a constant-conditioned IF to its positive branch (condition > 0)",
  async () => {
    await initWasmForTests();

    // const-cond (1.0) --condition w0.5--> if-neuron (IF) --> output-0
    // input-0  ---------positive  w0.6--/
    // const-neg (0.3) --negative  w0.4--/
    //
    // condition = 1.0 * 0.5 = 0.5 > 0 → positive branch is always taken. The IF
    // collapses to IDENTITY carrying only the (varying) positive synapse; the
    // condition + negative synapses are dropped and both constants strand.
    const json = loadFixture("test/data/if-collapse-positive.json");

    const creature = Creature.fromJSON(json, false);
    creature.validate();

    const data = makeData(creature.input);

    const compacted = compactCreature(creature, false);
    assert(compacted !== undefined, "should have compacted");
    creatureValidate(compacted!, { forwardOnly: true });

    const neurons = compacted!.neurons;
    const exported = compacted!.exportJSON();

    // The IF neuron survives as a plain additive (non-IF) neuron.
    const collapsed = neurons.find((n) => n.uuid === "if-neuron");
    assert(collapsed, "the collapsed neuron must be retained");
    assert(
      collapsed!.squash !== "IF",
      `IF squash must be rewritten, got ${collapsed!.squash}`,
    );

    // Only the positive-branch synapse survives into the collapsed neuron, with
    // no role type left on it.
    const inbound = exported.synapses.filter((s) => s.toUUID === "if-neuron");
    assertEquals(inbound.length, 1, "only the taken branch synapse survives");
    assertEquals(inbound[0].fromUUID, "input-0");
    assertEquals(inbound[0].type, undefined, "surviving synapse is additive");

    // Constants that fed the condition / untaken branch are gone.
    assertEquals(
      neurons.some((n) => n.uuid === "const-cond"),
      false,
      "condition constant should be stranded and cleaned up",
    );
    assertEquals(
      neurons.some((n) => n.uuid === "const-neg"),
      false,
      "untaken-branch constant should be stranded and cleaned up",
    );

    // Lower neuron / synapse counts.
    assert(
      compacted!.neurons.length < creature.neurons.length,
      "neuron count should drop",
    );
    assert(
      compacted!.synapses.length < creature.synapses.length,
      "synapse count should drop",
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
  "compactCreature collapses a constant-conditioned IF to its negative branch (condition <= 0)",
  async () => {
    await initWasmForTests();

    // const-cond (1.0) --condition w-0.5--> if-neuron (IF) --> output-0
    // input-1  ---------negative  w0.7--/
    // const-pos (0.2) --positive  w0.9--/
    //
    // condition = 1.0 * -0.5 = -0.5 <= 0 → negative branch is always taken.
    const json = loadFixture("test/data/if-collapse-negative.json");

    const creature = Creature.fromJSON(json, false);
    creature.validate();

    const data = makeData(creature.input);

    const compacted = compactCreature(creature, false);
    assert(compacted !== undefined, "should have compacted");
    creatureValidate(compacted!, { forwardOnly: true });

    const neurons = compacted!.neurons;
    const exported = compacted!.exportJSON();

    const collapsed = neurons.find((n) => n.uuid === "if-neuron");
    assert(collapsed, "the collapsed neuron must be retained");
    assert(
      collapsed!.squash !== "IF",
      `IF squash must be rewritten, got ${collapsed!.squash}`,
    );

    // Only the negative-branch (varying) synapse survives, stripped of its role.
    const inbound = exported.synapses.filter((s) => s.toUUID === "if-neuron");
    assertEquals(inbound.length, 1, "only the taken branch synapse survives");
    assertEquals(inbound[0].fromUUID, "input-1");
    assertEquals(inbound[0].type, undefined, "surviving synapse is additive");

    assertEquals(
      neurons.some((n) => n.uuid === "const-cond"),
      false,
      "condition constant should be stranded and cleaned up",
    );
    assertEquals(
      neurons.some((n) => n.uuid === "const-pos"),
      false,
      "untaken-branch constant should be stranded and cleaned up",
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
  "compactCreature leaves an IF with a varying condition input unchanged",
  async () => {
    await initWasmForTests();

    // input-0 --condition w0.5--> if-neuron (IF) --> output-0
    // const-pos (0.4) -positive w0.6--/
    // input-1 ---------negative  w0.3--/
    //
    // The condition input varies, so the selector is not fixed and the IF must
    // be left intact (this case belongs to the aggressive variant, not here).
    const json = loadFixture("test/data/if-collapse-varying-condition.json");

    const creature = Creature.fromJSON(json, false);
    creature.validate();

    const data = makeData(creature.input);

    const compacted = compactCreature(creature, false);
    // The IF survives regardless of whether any unrelated compaction happened.
    const after = compacted ?? creature;
    creatureValidate(after, { forwardOnly: true });

    const ifNeuron = after.neurons.find((n) => n.uuid === "if-neuron");
    assert(ifNeuron, "IF neuron must be retained");
    assertEquals(
      ifNeuron!.squash,
      "IF",
      "IF with a varying condition must stay an IF",
    );

    // The condition synapse must still be present and typed.
    const exported = after.exportJSON();
    const condition = exported.synapses.find(
      (s) => s.toUUID === "if-neuron" && s.type === "condition",
    );
    assert(condition, "the condition synapse must be retained");
    assertEquals(condition!.fromUUID, "input-0");

    assertOutputsPreserved(creature, after, data, creature.output);
  },
);
