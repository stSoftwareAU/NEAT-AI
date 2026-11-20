/**
 * Issue #4185: a neuron changed away from `IF` must not keep the roles
 * (`condition` / `positive` / `negative`) on its inward synapses.
 *
 * Only an `IF` target reads roles. Once it is any other squash, two rows from
 * one source are a validator error and the roles are meaningless, so the role
 * is cleared and the rows that now share a `(from, to)` pair are summed.
 *
 * Covers the live path (`Neuron.setSquash`), the export path
 * (`clearStaleSynapseRoles`) and the output-squash pin (Issue #3797).
 */

import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertFalse,
  assertThrows,
} from "@std/assert";
import type { CreatureInternal } from "@architecture/CreatureInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { Activations } from "@methods/activations/Activations.ts";
import { clearStaleSynapseRoles } from "../../mod.ts";

/**
 * Hidden `IF` neurons `if-a` (3) and `if-b` (4).
 *
 * `if-a` takes two roles from input 1 (`negative` 0.25 and `positive` 0.6),
 * which become one untyped row of 0.85 once the role is gone. `if-b` is fed by
 * `if-a` as a `positive` source, so its roles must survive a change to `if-a`.
 */
const fixture: CreatureInternal = {
  neurons: [
    { type: "input", squash: "LOGISTIC", index: 0 },
    { type: "input", squash: "LOGISTIC", index: 1 },
    { type: "input", squash: "LOGISTIC", index: 2 },
    {
      type: "hidden",
      squash: "IF",
      index: 3,
      bias: 0.1,
      uuid: "if-a",
      tags: [{ name: "neuron-tag", value: "kept" }],
    },
    { type: "hidden", squash: "IF", index: 4, bias: 0.2, uuid: "if-b" },
    { type: "output", squash: "LOGISTIC", index: 5, bias: 0 },
  ],
  synapses: [
    {
      from: 0,
      to: 3,
      weight: 0.5,
      type: "condition",
      tags: [{ name: "keep", value: "me" }],
    },
    { from: 0, to: 4, weight: 0.3, type: "condition" },
    { from: 1, to: 3, weight: 0.25, type: "negative" },
    { from: 1, to: 3, weight: 0.6, type: "positive" },
    { from: 1, to: 4, weight: 0.4, type: "negative" },
    { from: 2, to: 3, weight: 0.7, type: "negative" },
    { from: 3, to: 4, weight: 0.8, type: "positive" },
    { from: 4, to: 5, weight: 0.9 },
  ],
  input: 3,
  output: 1,
};

/** An output neuron that is `IF`, with all three roles from its inputs. */
const outputIfFixture: CreatureInternal = {
  neurons: [
    { type: "input", squash: "LOGISTIC", index: 0 },
    { type: "input", squash: "LOGISTIC", index: 1 },
    { type: "input", squash: "LOGISTIC", index: 2 },
    { type: "output", squash: "IF", index: 3, bias: 0.1 },
  ],
  synapses: [
    { from: 0, to: 3, weight: 0.5, type: "condition" },
    { from: 1, to: 3, weight: 0.25, type: "negative" },
    { from: 1, to: 3, weight: 0.6, type: "positive" },
    { from: 2, to: 3, weight: 0.7, type: "negative" },
  ],
  input: 3,
  output: 1,
};

/**
 * Assert that the rows into `if-a` are the flattened form: one untyped row per
 * source, the duplicate source summed, tags kept, and `if-a -> if-b` still a
 * `positive` role because `if-b` is still `IF`.
 */
function assertIfAFlattened(synapses: SynapseExport[]): void {
  const into = synapses.filter((s) => s.toUUID === "if-a");
  assertEquals(into.length, 3, "one row per source once the roles are gone");
  for (const s of into) {
    assertEquals(
      s.type,
      undefined,
      `${s.fromUUID} -> if-a still carries a role`,
    );
    // `Synapse.toJSON` writes `type: undefined` for an untyped row, which the
    // wire form drops, so the check that matters is the serialised form.
    assertFalse(
      "type" in JSON.parse(JSON.stringify(s)),
      `${s.fromUUID} -> if-a serialises a role`,
    );
  }
  const byFrom = new Map(into.map((s) => [s.fromUUID, s]));
  assertAlmostEquals(byFrom.get("input-0")!.weight, 0.5);
  assertAlmostEquals(byFrom.get("input-1")!.weight, 0.85);
  assertAlmostEquals(byFrom.get("input-2")!.weight, 0.7);
  assertEquals(byFrom.get("input-0")!.tags, [{ name: "keep", value: "me" }]);

  const ab = synapses.find((s) => s.fromUUID === "if-a" && s.toUUID === "if-b");
  assertEquals(ab?.type, "positive");
  assertAlmostEquals(ab!.weight, 0.8);
}

Deno.test("live: setSquash away from IF clears roles on inward synapses (Issue #4185)", () => {
  const creature = Creature.fromJSON(fixture);
  creatureValidate(creature);

  const ifA = creature.neurons[3];
  ifA.setSquash("RELU");

  const into = creature.synapses.filter((s) => s.to === 3);
  assertEquals(into.length, 3, "one row per source after the change");
  for (const s of into) {
    assertEquals(s.type, undefined, `synapse ${s.from}->3 still has a role`);
  }
  const from0 = into.find((s) => s.from === 0)!;
  assertAlmostEquals(from0.weight, 0.5);
  assertEquals(from0.tags, [{ name: "keep", value: "me" }]);
  const from1 = into.find((s) => s.from === 1)!;
  assertAlmostEquals(from1.weight, 0.85);
  const from2 = into.find((s) => s.from === 2)!;
  assertAlmostEquals(from2.weight, 0.7);

  // if-b is still IF, so its roles and the if-a -> if-b role are untouched.
  const ifBRoles = creature.synapses
    .filter((s) => s.to === 4)
    .map((s) => `${s.from}:${s.type}`);
  assertEquals(ifBRoles.sort(), ["0:condition", "1:negative", "3:positive"]);
  const ab = creature.synapses.find((s) => s.from === 3 && s.to === 4)!;
  assertEquals(ab.type, "positive");
  assertAlmostEquals(ab.weight, 0.8);

  assertEquals(ifA.bias, 0.1);
  assertEquals(ifA.tags, [{ name: "neuron-tag", value: "kept" }]);

  creatureValidate(creature);
  const activation = creature.activate(new Float32Array([1, 1, 1]));
  assert(
    Array.from(activation).every((v) => Number.isFinite(v)),
    "activation must stay finite",
  );

  const exported = creature.exportJSON();
  assertIfAFlattened(exported.synapses);
  assertEquals(
    exported.synapses.find((s) =>
      s.fromUUID === "input-0" && s.toUUID === "if-b"
    )
      ?.type,
    "condition",
  );

  const reloaded = Creature.fromJSON(exported);
  creatureValidate(reloaded);
  assertIfAFlattened(reloaded.exportJSON().synapses);
});

Deno.test("live: setSquash('IF') on an IF neuron changes nothing (Issue #4185)", () => {
  const creature = Creature.fromJSON(fixture);
  const before = creature.exportJSON().synapses;

  creature.neurons[3].setSquash("IF");

  assertEquals(creature.exportJSON().synapses, before);
  creatureValidate(creature);
});

Deno.test("live: pinned output IF -> RELU under an IDENTITY pin clears roles (Issue #4185)", () => {
  const creature = Creature.fromJSON(outputIfFixture);
  try {
    Activations.setFixedOutputSquash("IDENTITY");
    creature.neurons[3].setSquash("RELU");
    assertEquals(creature.neurons[3].squash, "IDENTITY");

    const into = creature.synapses.filter((s) => s.to === 3);
    assertEquals(into.length, 3, "one row per source after the change");
    for (const s of into) {
      assertEquals(s.type, undefined, `synapse ${s.from}->3 still has a role`);
    }
    assertAlmostEquals(into.find((s) => s.from === 1)!.weight, 0.85);
    creatureValidate(creature);
  } finally {
    Activations.setFixedOutputSquash(null);
  }
});

Deno.test("live: pinned output IF with an IF pin keeps roles (Issue #4185)", () => {
  const creature = Creature.fromJSON(outputIfFixture);
  try {
    Activations.setFixedOutputSquash("IF");
    creature.neurons[3].setSquash("RELU");
    assertEquals(creature.neurons[3].squash, "IF");

    const types = creature.synapses
      .filter((s) => s.to === 3)
      .map((s) => s.type)
      .sort();
    assertEquals(types, ["condition", "negative", "negative", "positive"]);
    creatureValidate(creature);
  } finally {
    Activations.setFixedOutputSquash(null);
  }
});

Deno.test("export op: clears roles into a substituted IF neuron (Issue #4185)", () => {
  const exported = Creature.fromJSON(fixture).exportJSON();
  const ifA = exported.neurons.find((n) => n.uuid === "if-a");
  assert(ifA, "fixture neuron if-a missing from export");
  ifA.squash = "RELU";

  const before = structuredClone(exported);
  const cleared = clearStaleSynapseRoles(exported, "if-a");

  assertEquals(cleared, 4, "four roles into if-a were cleared");
  assertIfAFlattened(exported.synapses);
  assertEquals(
    exported.synapses.filter((s) => s.toUUID !== "if-a"),
    before.synapses.filter((s) => s.toUUID !== "if-a"),
    "rows into other neurons must not change",
  );

  const reloaded = Creature.fromJSON(exported);
  creatureValidate(reloaded);
  assertIfAFlattened(reloaded.exportJSON().synapses);
});

Deno.test("export op: an effective IF neuron is left alone (Issue #4185)", () => {
  const exported = Creature.fromJSON(fixture).exportJSON();
  const before = structuredClone(exported);

  assertEquals(clearStaleSynapseRoles(exported, "if-a"), 0);
  assertEquals(exported, before);
});

Deno.test("export op: pinned output squash is judged by the effective squash (Issue #4185)", () => {
  // Build the exports before the pin is set: loading normalises output
  // squash to the pin, which would hide the case under test.
  const exportedIdentity = Creature.fromJSON(outputIfFixture).exportJSON();
  const exportedIf = Creature.fromJSON(outputIfFixture).exportJSON();

  try {
    // The export says IF but the pin says IDENTITY: the effective squash is
    // IDENTITY, so the roles go.
    Activations.setFixedOutputSquash("IDENTITY");
    const exported = exportedIdentity;
    const output = exported.neurons.find((n) => n.type === "output");
    assert(output?.uuid, "output neuron must carry a uuid in the export");
    assertEquals(output.squash, "IF");

    assertEquals(clearStaleSynapseRoles(exported, output.uuid), 4);
    const into = exported.synapses.filter((s) => s.toUUID === output.uuid);
    assertEquals(into.length, 3);
    for (const s of into) assertFalse("type" in s);
    creatureValidate(Creature.fromJSON(exported));
  } finally {
    Activations.setFixedOutputSquash(null);
  }

  try {
    // The export says RELU but the pin says IF: the effective squash is IF,
    // so the roles stay.
    Activations.setFixedOutputSquash("IF");
    const exported = exportedIf;
    const output = exported.neurons.find((n) => n.type === "output");
    assert(output?.uuid, "output neuron must carry a uuid in the export");
    output.squash = "RELU";
    const before = structuredClone(exported);

    assertEquals(clearStaleSynapseRoles(exported, output.uuid), 0);
    assertEquals(exported, before);
  } finally {
    Activations.setFixedOutputSquash(null);
  }
});

Deno.test("export op: an unknown neuron uuid is an error naming it (Issue #4185)", () => {
  const exported = Creature.fromJSON(fixture).exportJSON();
  assertThrows(
    () => clearStaleSynapseRoles(exported, "no-such-neuron"),
    Error,
    "no-such-neuron",
  );
});
