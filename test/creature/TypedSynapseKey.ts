/**
 * Synapses are keyed by `(from, to, type)`, so one source can feed both
 * branches of an `IF` without an IDENTITY relay standing in as a second
 * distinct source (Issue #3873).
 *
 * Only an `IF` target may carry more than one role from one source: every other
 * squash sums its inward synapses regardless of role, so a repeated pair there
 * says nothing a single summed synapse could not.
 */
import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { compareSynapses } from "@architecture/SynapseKey.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * One source (`shared`) feeds both branches of an `IF` directly — the shape the
 * `(from, to)` key forbade.
 */
function sharedBranchIf(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 3,
    output: 1,
    neurons: [
      { type: "constant", uuid: "constant-threshold", bias: 1 },
      { type: "hidden", uuid: "shared", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "gate", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "shared", weight: 0.6 },
      { fromUUID: "input-1", toUUID: "gate", weight: 1, type: "condition" },
      {
        fromUUID: "constant-threshold",
        toUUID: "gate",
        weight: -0.35,
        type: "condition",
      },
      { fromUUID: "shared", toUUID: "gate", weight: 0.5, type: "positive" },
      { fromUUID: "shared", toUUID: "gate", weight: 0.5, type: "negative" },
      { fromUUID: "gate", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 0.2 },
    ],
  };
}

/**
 * The same behaviour written the old way: an IDENTITY relay exists only so the
 * `negative` branch has a source distinct from the `positive` one.
 */
function sharedBranchIfViaRelay(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 3,
    output: 1,
    neurons: [
      { type: "constant", uuid: "constant-threshold", bias: 1 },
      { type: "hidden", uuid: "shared", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "relay", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "gate", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "shared", weight: 0.6 },
      { fromUUID: "shared", toUUID: "relay", weight: 1 },
      { fromUUID: "input-1", toUUID: "gate", weight: 1, type: "condition" },
      {
        fromUUID: "constant-threshold",
        toUUID: "gate",
        weight: -0.35,
        type: "condition",
      },
      { fromUUID: "shared", toUUID: "gate", weight: 0.5, type: "positive" },
      { fromUUID: "relay", toUUID: "gate", weight: 0.5, type: "negative" },
      { fromUUID: "gate", toUUID: "output-0", weight: 1 },
      { fromUUID: "input-2", toUUID: "output-0", weight: 0.2 },
    ],
  };
}

/** Index of the neuron carrying `uuid`. */
function indexOf(creature: Creature, uuid: string): number {
  const indx = creature.neurons.findIndex((n) => n.uuid === uuid);
  assert(indx >= 0, `no neuron ${uuid}`);
  return indx;
}

Deno.test("typed key: an IF target accepts both roles from one source", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(sharedBranchIf());
  creatureValidate(creature);

  const shared = indexOf(creature, "shared");
  const gate = indexOf(creature, "gate");

  const roles = creature.getSynapses(shared, gate).map((s) => s.type);
  assertEquals(roles, ["negative", "positive"], "both roles survive the load");

  assertEquals(creature.getSynapse(shared, gate, "positive")?.weight, 0.5);
  assertEquals(creature.getSynapse(shared, gate, "negative")?.weight, 0.5);
  assertEquals(creature.getSynapse(shared, gate, "condition"), null);
});

Deno.test("typed key: the direct pair activates like the IDENTITY relay it replaces", async () => {
  await initWasmForTests();
  const direct = Creature.fromJSON(sharedBranchIf());
  const viaRelay = Creature.fromJSON(sharedBranchIfViaRelay());

  for (const [a, b, c] of [[1, 1, 1], [-1, -1, 0.5], [0.25, 2, -3], [3, -2, 0]]) {
    const input = new Float32Array([a, b, c]);
    assertEquals(
      Array.from(direct.activate(input)),
      Array.from(viaRelay.activate(input)),
      `same output for [${a}, ${b}, ${c}]`,
    );
  }

  assertEquals(
    direct.neurons.length,
    viaRelay.neurons.length - 1,
    "the relay neuron is no longer needed",
  );
});

Deno.test("typed key: connect adds a second role into an IF target", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(sharedBranchIf());
  const input1 = 1;
  const gate = indexOf(creature, "gate");

  // input-1 already feeds the gate as `condition`; a `positive` edge from the
  // same source is a different synapse.
  const added = creature.connect(input1, gate, 0.25, "positive");
  assertEquals(added.type, "positive");
  assertEquals(creature.getSynapses(input1, gate).length, 2);
  creatureValidate(creature);
});

Deno.test("typed key: connect rejects an exact (from, to, type) repeat", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(sharedBranchIf());
  const shared = indexOf(creature, "shared");
  const gate = indexOf(creature, "gate");

  assertThrows(
    () => creature.connect(shared, gate, 0.1, "positive"),
    Error,
    "Connection already exists",
  );
});

Deno.test("typed key: connect rejects a second role into a non-IF target", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(sharedBranchIf());
  const shared = indexOf(creature, "shared");
  const output = indexOf(creature, "output-0");

  creature.connect(shared, output, 0.3, "positive");
  assertThrows(
    () => creature.connect(shared, output, 0.3, "negative"),
    Error,
    "not an 'IF' neuron",
  );
});

Deno.test("typed key: synapses stay sorted by (from, to, type)", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(sharedBranchIf());
  const input1 = 1;
  const gate = indexOf(creature, "gate");

  // Insert out of canonical order: `positive` (rank 3) before `negative` (2).
  creature.connect(input1, gate, 0.25, "positive");
  creature.connect(input1, gate, 0.25, "negative");

  for (let i = 1; i < creature.synapses.length; i++) {
    assert(
      compareSynapses(creature.synapses[i - 1], creature.synapses[i]) < 0,
      `synapse ${i} out of canonical order`,
    );
  }
  creatureValidate(creature);
});

Deno.test("typed key: disconnect removes one role or every role", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(sharedBranchIf());
  const shared = indexOf(creature, "shared");
  const gate = indexOf(creature, "gate");

  creature.disconnect(shared, gate, "positive");
  assertEquals(
    creature.getSynapses(shared, gate).map((s) => s.type),
    ["negative"],
    "only the named role is removed",
  );

  const both = Creature.fromJSON(sharedBranchIf());
  both.disconnect(shared, gate);
  assertEquals(
    both.getSynapses(shared, gate).length,
    0,
    "an untyped disconnect removes every role",
  );
});

Deno.test("typed key: hasConnection answers per pair and per role", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(sharedBranchIf());
  const shared = indexOf(creature, "shared");
  const gate = indexOf(creature, "gate");

  assert(creature.hasConnection(shared, gate));
  assert(creature.hasConnection(shared, gate, "positive"));
  assert(creature.hasConnection(shared, gate, "negative"));
  assert(!creature.hasConnection(shared, gate, "condition"));
  assert(!creature.hasConnection(gate, shared));
});

Deno.test("typed key: connectBatch keys by the triple", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(sharedBranchIf());
  const input1 = 1;
  const gate = indexOf(creature, "gate");
  const output = indexOf(creature, "output-0");

  creature.connectBatch([
    { from: input1, to: gate, weight: 0.2, type: "positive" },
    { from: input1, to: gate, weight: 0.3, type: "negative" },
  ]);
  assertEquals(creature.getSynapses(input1, gate).length, 3);
  creatureValidate(creature);

  assertThrows(
    () =>
      creature.connectBatch([
        { from: input1, to: gate, weight: 0.2, type: "positive" },
      ]),
    Error,
    "already exists",
  );

  assertThrows(
    () =>
      creature.connectBatch([
        { from: input1, to: output, weight: 0.2, type: "positive" },
        { from: input1, to: output, weight: 0.2, type: "negative" },
      ]),
    Error,
    "not an 'IF' neuron",
  );
});

Deno.test("typed key: an export round-trip keeps both roles", async () => {
  await initWasmForTests();
  const creature = Creature.fromJSON(sharedBranchIf());
  const round = Creature.fromJSON(creature.exportJSON());
  creatureValidate(round);

  const shared = indexOf(round, "shared");
  const gate = indexOf(round, "gate");
  assertEquals(
    round.getSynapses(shared, gate).map((s) => s.weight),
    [0.5, 0.5],
    "loadFrom must not merge two roles into one synapse",
  );
});

Deno.test("typed key: a repeated pair into a non-IF target is still merged on load", async () => {
  await initWasmForTests();
  const json = sharedBranchIf();
  json.synapses.push({
    fromUUID: "gate",
    toUUID: "output-0",
    weight: 0.25,
    type: "positive",
  });

  const creature = Creature.fromJSON(json);
  const gate = indexOf(creature, "gate");
  const output = indexOf(creature, "output-0");
  assertEquals(
    creature.getSynapses(gate, output).length,
    1,
    "a non-IF target cannot read two roles, so the rows coalesce",
  );
  assertEquals(creature.getSynapse(gate, output)?.weight, 1.25);
  creatureValidate(creature);
});
