import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { exportJSONUnchecked } from "@creature/CreatureSerialization.ts";
import { compactCreature } from "@compact/CompactCreature.ts";
import {
  CANONICAL_CONSTANT_UUIDS,
  mergeRedundantConstants,
} from "@compact/ConstantMerge.ts";
import { calculate } from "@architecture/Score.ts";
import { initWasmForTests } from "../_initWasm.ts";

// Issue #3808: generating IF-squash trees leaves one `type:"constant"` neuron
// per branch, each with its own bias, because the constant fold cannot absorb a
// producer feeding an aggregate consumer. Compaction must merge them into at
// most three canonical bias-1 constants with fleet-wide UUIDs — the error stays
// identical while the score improves as the redundant neurons disappear.

const GROWTH_COST = 0.0001;

function makeData(inputs: number, rows = 200): number[][] {
  const data: number[][] = [];
  for (let i = rows; i--;) {
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
) {
  for (const row of data) {
    const expected = before.activate(new Float32Array(row), false);
    const actual = after.activate(new Float32Array(row), false);
    for (let o = 0; o < before.output; o++) {
      assertAlmostEquals(
        actual[o],
        expected[o],
        0.000_001,
        `output ${o}: actual ${actual[o]}, expected ${expected[o]}`,
      );
    }
  }
}

function constants(creature: Creature) {
  return creature.neurons.filter((neuron) => neuron.type === "constant");
}

function assertNoDuplicateSynapses(creature: Creature) {
  const seen = new Set<string>();
  for (const synapse of creature.synapses) {
    const key = `${synapse.from}:${synapse.to}`;
    assert(!seen.has(key), `duplicate synapse ${key}`);
    seen.add(key);
  }
}

/**
 * A creature shaped like the IF-forests the GRQ fleet evolves: `count` IF
 * neurons, each fed by its own pair of differently-biased constants on the
 * positive and negative branches, with a varying condition input so the IF
 * cannot be collapsed away.
 */
function makeConstantForest(count: number): CreatureExport {
  const neurons: CreatureExport["neurons"] = [];
  const synapses: CreatureExport["synapses"] = [];

  for (let i = 0; i < count; i++) {
    neurons.push({
      type: "constant",
      uuid: `const-pos-${i}`,
      bias: 0.1 * (i + 1),
    });
    neurons.push({
      type: "constant",
      uuid: `const-neg-${i}`,
      bias: -0.2 * (i + 1),
    });
  }

  for (let i = 0; i < count; i++) {
    neurons.push({ type: "hidden", uuid: `if-${i}`, squash: "IF", bias: 0 });
    synapses.push({
      fromUUID: "input-0",
      toUUID: `if-${i}`,
      weight: 0.3 + i * 0.1,
      type: "condition",
    });
    synapses.push({
      fromUUID: `const-pos-${i}`,
      toUUID: `if-${i}`,
      weight: 0.5,
      type: "positive",
    });
    synapses.push({
      fromUUID: `const-neg-${i}`,
      toUUID: `if-${i}`,
      weight: 0.7,
      type: "negative",
    });
    synapses.push({
      fromUUID: `if-${i}`,
      toUUID: "output-0",
      weight: 1 / count,
    });
  }

  neurons.push({
    type: "output",
    uuid: "output-0",
    squash: "IDENTITY",
    bias: 0,
  });
  synapses.push({ fromUUID: "input-1", toUUID: "output-0", weight: 0.25 });

  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 2,
    output: 1,
    neurons,
    synapses,
  };
}

Deno.test(
  "compactCreature merges a forest of differently-biased constants into canonical bias-1 constants",
  async () => {
    await initWasmForTests();

    const creature = Creature.fromJSON(makeConstantForest(12), false);
    creature.validate();
    assertEquals(constants(creature).length, 24, "24 distinct constants");

    const data = makeData(creature.input);

    const compacted = compactCreature(creature, false);
    assert(compacted !== undefined, "should have compacted");
    creatureValidate(compacted!, { forwardOnly: true });
    assertNoDuplicateSynapses(compacted!);

    const merged = constants(compacted!);
    assert(
      merged.length <= CANONICAL_CONSTANT_UUIDS.length,
      `expected at most ${CANONICAL_CONSTANT_UUIDS.length} constants, got ${merged.length}`,
    );
    for (const neuron of merged) {
      assertEquals(neuron.bias, 1, `${neuron.uuid} must carry bias 1`);
      assert(
        CANONICAL_CONSTANT_UUIDS.includes(neuron.uuid ?? ""),
        `constant UUID must be well known, got ${neuron.uuid}`,
      );
    }

    assert(
      compacted!.neurons.length < creature.neurons.length,
      `neuron count should drop: ${creature.neurons.length} -> ${
        compacted!.neurons.length
      }`,
    );

    // Identical error, better score — the whole point of the merge.
    assertOutputsPreserved(creature, compacted!, data);

    const beforeScore = calculate(creature, 0, GROWTH_COST);
    const afterScore = calculate(compacted!, 0, GROWTH_COST);
    assert(
      afterScore > beforeScore,
      `score should improve: before ${beforeScore}, after ${afterScore}`,
    );
  },
);

Deno.test(
  "compactCreature merges the three constants of a single IF, one per role",
  async () => {
    await initWasmForTests();

    // A varying condition input keeps the IF alive, so the three constants are
    // merged rather than collapsed away with the IF.
    const json: CreatureExport = {
      semanticVersion: "4.0.0",
      forwardOnly: true,
      input: 2,
      output: 1,
      neurons: [
        { type: "constant", uuid: "const-cond", bias: 0.5 },
        { type: "constant", uuid: "const-pos", bias: -0.25 },
        { type: "constant", uuid: "const-neg", bias: 2 },
        { type: "hidden", uuid: "if-neuron", squash: "IF", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "if-neuron",
          weight: 1,
          type: "condition",
        },
        {
          fromUUID: "const-cond",
          toUUID: "if-neuron",
          weight: 0.4,
          type: "condition",
        },
        {
          fromUUID: "input-1",
          toUUID: "if-neuron",
          weight: 0.7,
          type: "positive",
        },
        {
          fromUUID: "const-pos",
          toUUID: "if-neuron",
          weight: 0.6,
          type: "positive",
        },
        {
          fromUUID: "const-neg",
          toUUID: "if-neuron",
          weight: 0.3,
          type: "negative",
        },
        { fromUUID: "if-neuron", toUUID: "output-0", weight: 1 },
      ],
    };

    const creature = Creature.fromJSON(json, false);
    creature.validate();

    const data = makeData(creature.input);

    const compacted = compactCreature(creature, false);
    assert(compacted !== undefined, "should have compacted");
    creatureValidate(compacted!, { forwardOnly: true });
    assertNoDuplicateSynapses(compacted!);

    const exported = compacted!.exportJSON();
    const inbound = exported.synapses.filter((s) => s.toUUID === "if-neuron");

    // One canonical constant per role — a (from, to) pair may hold only one
    // synapse, so the three roles cannot share a source neuron.
    const constantSources = inbound
      .filter((s) => CANONICAL_CONSTANT_UUIDS.includes(s.fromUUID ?? ""))
      .map((s) => s.fromUUID);
    assertEquals(
      new Set(constantSources).size,
      3,
      "three distinct canonical constants feed the IF",
    );

    const byRole = (role: string) =>
      inbound.find((s) =>
        (s.type ?? "positive") === role &&
        CANONICAL_CONSTANT_UUIDS.includes(s.fromUUID ?? "")
      );
    assertAlmostEquals(byRole("condition")!.weight, 0.4 * 0.5, 1e-6);
    assertAlmostEquals(byRole("positive")!.weight, 0.6 * -0.25, 1e-6);
    assertAlmostEquals(byRole("negative")!.weight, 0.3 * 2, 1e-6);

    assertOutputsPreserved(creature, compacted!, data);
  },
);

Deno.test(
  "compactCreature keeps a surplus constant rather than duplicating a synapse",
  async () => {
    await initWasmForTests();

    // MAXIMUM reads each inbound value separately, so four constants need four
    // distinct sources. Only three canonical slots exist — the fourth constant
    // must survive untouched instead of duplicating a (from, to) pair.
    const json: CreatureExport = {
      semanticVersion: "4.0.0",
      forwardOnly: true,
      input: 1,
      output: 1,
      neurons: [
        { type: "constant", uuid: "const-a", bias: 0.5 },
        { type: "constant", uuid: "const-b", bias: -2 },
        { type: "constant", uuid: "const-c", bias: 3 },
        { type: "constant", uuid: "const-d", bias: 0.25 },
        { type: "hidden", uuid: "max-neuron", squash: "MAXIMUM", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "max-neuron", weight: 1 },
        { fromUUID: "const-a", toUUID: "max-neuron", weight: 0.6 },
        { fromUUID: "const-b", toUUID: "max-neuron", weight: 0.7 },
        { fromUUID: "const-c", toUUID: "max-neuron", weight: 0.8 },
        { fromUUID: "const-d", toUUID: "max-neuron", weight: 0.9 },
        { fromUUID: "max-neuron", toUUID: "output-0", weight: 1 },
      ],
    };

    const creature = Creature.fromJSON(json, false);
    creature.validate();

    const data = makeData(creature.input);

    const compacted = compactCreature(creature, false);
    assert(compacted !== undefined, "should have compacted");
    creatureValidate(compacted!, { forwardOnly: true });
    assertNoDuplicateSynapses(compacted!);

    const surviving = constants(compacted!).map((n) => n.uuid).sort();
    assertEquals(
      surviving,
      [
        "const-d",
        ...CANONICAL_CONSTANT_UUIDS,
      ].sort(),
    );

    assertOutputsPreserved(creature, compacted!, data);
  },
);

Deno.test(
  "GRQ-23-forests fixture — 277 constants merge to canonical bias-1 constants",
  async () => {
    await initWasmForTests();

    // The worst offender across the GRQ-sampler `samples/*.json` fleet snapshot
    // (Issue #3808): an IF-forest creature carrying 277 constants with 263
    // distinct biases, none of which the constant fold can absorb.
    const json: CreatureExport = JSON.parse(
      await Deno.readTextFile("./test/data/grq-23-forests-constants.json"),
    );
    const creature = Creature.fromJSON(json, false);
    creatureValidate(creature, { forwardOnly: true });
    assertEquals(
      constants(creature).length,
      277,
      "the fixture's constant pile",
    );

    // Exactness is asserted on the merge itself: the surrounding compaction
    // passes have their own (separately tracked) tolerances on this creature.
    const merged = exportJSONUnchecked(creature);
    const result = mergeRedundantConstants(merged);
    assert(result.changed, "the constants must merge");
    const mergedCreature = Creature.fromJSON(merged, false, "constant-merge", {
      throwOnRecurrent: "never",
    });
    creatureValidate(mergedCreature, { forwardOnly: true });
    assertNoDuplicateSynapses(mergedCreature);

    const survivors = constants(mergedCreature);
    assert(
      survivors.length <= CANONICAL_CONSTANT_UUIDS.length,
      `expected at most ${CANONICAL_CONSTANT_UUIDS.length} constants, got ${survivors.length}`,
    );
    for (const neuron of survivors) {
      assertEquals(neuron.bias, 1, `${neuron.uuid} must carry bias 1`);
      assert(
        CANONICAL_CONSTANT_UUIDS.includes(neuron.uuid ?? ""),
        `constant UUID must be well known, got ${neuron.uuid}`,
      );
    }
    assertEquals(
      mergedCreature.neurons.length,
      creature.neurons.length - 277 + survivors.length,
      "every merged-away constant is gone",
    );

    // Identical error: a handful of rows over 2 511 inputs is enough to catch
    // any drift in the bias → weight rewrite.
    assertOutputsPreserved(
      creature,
      mergedCreature,
      makeData(creature.input, 5),
    );

    // …and the full compaction keeps the constant pile collapsed.
    const compacted = compactCreature(creature, false);
    assert(compacted !== undefined, "should have compacted");
    creatureValidate(compacted!, { forwardOnly: true });
    assert(
      constants(compacted!).length <= CANONICAL_CONSTANT_UUIDS.length,
      "compaction must not leave the constant pile behind",
    );
  },
);
