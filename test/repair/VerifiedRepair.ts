import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { RepairError } from "@errors/RepairError.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import { Upgrade } from "@reconstruct/Upgrade.ts";
import { auditRepair, findRoleRewiring } from "@repair/RepairAudit.ts";
import {
  assertBehaviourNotLost,
  assertRoleStructurePreserved,
  captureBehaviourBaseline,
  verifiedRepair,
} from "@repair/VerifiedRepair.ts";
import {
  graftedIfForest,
  graftedIfForestWithZeroLeaf,
  pointWiseCreature,
} from "../fixtures/StructuralFamilies.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #3848 — the repair contract.
 *
 * #3845 made the load-time repair a no-op when `validate()` passes, which stops
 * the bleeding but sidesteps the point: a *partly* invalid creature still goes
 * through the repair, and the repair itself has to be safe. These tests pin the
 * five principles that outage taught, in the order the issue states them.
 */

/** A grafted forest with one genuinely stranded constant bolted on. */
function graftedForestWithStrandedConstant(): CreatureExport {
  const json = graftedIfForest();
  json.neurons.unshift({
    type: "constant",
    uuid: "constant-stranded",
    bias: 1,
  });
  return json;
}

/** A grafted forest whose `plain-1` relay has had every inbound edge cut. */
function graftedForestWithInboundlessHidden(): CreatureExport {
  const json = graftedIfForest();
  json.synapses = json.synapses.filter((s) => s.toUUID !== "plain-1");
  return json;
}

Deno.test("Issue #3848: a validation failure names the element it failed on", () => {
  const json = graftedForestWithStrandedConstant();
  const creature = Creature.fromJSON(json, false);

  let failure: unknown;
  try {
    creatureValidate(creature);
  } catch (e) {
    failure = e;
  }

  assert(failure instanceof ValidationError, "the rule must fail");
  assertEquals(failure.reason, "NO_OUTWARD_CONNECTIONS");
  assert(
    failure.neuronIndex !== undefined,
    "the failure must carry the index of the neuron it named — without it a " +
      "repair cannot be rule-driven",
  );
  assertEquals(
    creature.neurons[failure.neuronIndex].uuid,
    "constant-stranded",
    "the index must point at the offending neuron",
  );
});

Deno.test("Issue #3848: principle 2 — a repair changes the failing element and nothing else", () => {
  const before = Creature.fromJSON(graftedForestWithStrandedConstant(), false)
    .exportJSON();
  const after = Upgrade.correct(structuredClone(before), before.input)
    .exportJSON();
  const audit = auditRepair(before, after);

  assertEquals(
    audit.neuronsRemoved,
    ["constant-stranded"],
    "only the neuron the rule named may be removed",
  );
  assertEquals(audit.neuronsAdded, [], "a repair must invent no neuron");
  assertEquals(audit.neuronsAltered, [], "no other neuron may be rewritten");
  assertEquals(
    audit.synapsesRemoved,
    [],
    "the stranded constant had no edges, so no edge may be dropped with it",
  );
  assertEquals(audit.synapsesAdded, [], "a repair must invent no synapse");
  assertEquals(audit.weightsChanged, [], "a repair must move no weight");
});

Deno.test("Issue #3848: principle 2 — an inbound-less hidden keeps its uuid and its consumers", () => {
  const before = Creature.fromJSON(graftedForestWithInboundlessHidden(), false)
    .exportJSON();
  const after = Upgrade.correct(structuredClone(before), before.input)
    .exportJSON();
  const audit = auditRepair(before, after);

  const survivor = after.neurons.find((n) => n.uuid === "plain-1");
  assert(
    survivor,
    "the neuron must keep its uuid — a repair that renames a neuron breaks " +
      "cross-machine breeding, which aligns parents by uuid",
  );
  assertEquals(
    survivor.type,
    "constant",
    "a hidden neuron nothing writes to is the constant it already computes",
  );
  assertEquals(audit.neuronsAdded, [], "no substitute neuron may be invented");
  assertEquals(
    audit.synapsesAdded,
    [],
    "no inbound edge may be fabricated to keep it a hidden neuron",
  );
  assert(
    after.synapses.some((s) => s.fromUUID === "plain-1"),
    "everything downstream of it must survive",
  );
});

Deno.test("Issue #3848: principle 5 — the repair is idempotent", () => {
  for (
    const json of [
      graftedForestWithStrandedConstant(),
      graftedForestWithInboundlessHidden(),
    ]
  ) {
    const before = Creature.fromJSON(json, false).exportJSON();
    const once = Upgrade.correct(structuredClone(before), before.input)
      .exportJSON();
    const twice = Upgrade.correct(structuredClone(once), once.input)
      .exportJSON();

    assertEquals(
      JSON.stringify(twice),
      JSON.stringify(once),
      "running the repair a second time must change nothing",
    );
  }
});

Deno.test("Issue #3848: principle 5 — every change is reported as rule → element → action", () => {
  const creature = Creature.fromJSON(
    graftedForestWithStrandedConstant(),
    false,
  );
  const result = verifiedRepair(creature, { pass: "test" });

  assert(result.repaired, "the creature needed a repair");
  assertEquals(result.actions.length, 1, "one rule failed, so one action");
  assertEquals(result.actions[0].rule, "NO_OUTWARD_CONNECTIONS");
  assertEquals(result.actions[0].element, "constant-stranded");
  assertStringIncludes(result.actions[0].action, "removed");
  assertEquals(result.fellBack, false, "no rule needed the legacy pass");
  assertEquals(result.audit.neuronsRemoved, ["constant-stranded"]);
});

Deno.test("Issue #3848: a creature that validates is returned untouched and reports nothing", () => {
  const creature = Creature.fromJSON(graftedIfForestWithZeroLeaf(), false);
  const result = verifiedRepair(creature, { pass: "test" });

  assertEquals(result.repaired, false, "nothing needed repairing");
  assertEquals(result.actions, [], "and so nothing is reported");
  assertEquals(result.fellBack, false);
});

Deno.test("Issue #3848: principle 3 — re-sourcing an IF branch is refused", () => {
  const before = Creature.fromJSON(graftedIfForest(), false).exportJSON();
  const after = structuredClone(before);

  // The #3845 damage, exactly: a branch moved off its shared bias-1 constant
  // and onto an arbitrary input. Counts are unchanged, so no size check sees it.
  const branch = after.synapses.find(
    (s) => s.toUUID === "if-0-lo" && s.type === "positive",
  );
  assert(branch, "the fixture carries a positive branch on if-0-lo");
  branch.fromUUID = "input-0";

  const violations = findRoleRewiring(before, after, new Set());
  assertEquals(violations.length, 2, "one edge removed, one invented");
  assert(
    violations.some((v) => v.startsWith("removed")),
    `the lost edge must be reported — ${violations.join("; ")}`,
  );
  assert(
    violations.some((v) => v.startsWith("added")),
    `the invented edge must be reported — ${violations.join("; ")}`,
  );

  let refusal: unknown;
  try {
    assertRoleStructurePreserved(before, after, new Set(), "test");
  } catch (e) {
    refusal = e;
  }
  assert(refusal instanceof RepairError, "the contract must refuse it");
  assertEquals(refusal.reason, "ROLE_REWIRING");
  assertStringIncludes(refusal.message, "if-0-lo");
});

Deno.test("Issue #3848: principle 3 — downgrading an IF no rule named is refused", () => {
  const before = Creature.fromJSON(graftedIfForest(), false).exportJSON();
  const after = structuredClone(before);
  const gate = after.neurons.find((n) => n.uuid === "if-1-hi");
  assert(gate, "the fixture carries if-1-hi");
  gate.squash = "IDENTITY";

  assertEquals(
    findRoleRewiring(before, after, new Set()).length,
    1,
    "an unexplained downgrade discards the routing the roles encoded",
  );
  assertEquals(
    findRoleRewiring(before, after, new Set(["if-1-hi"])).length,
    0,
    "the same downgrade is legitimate once IF_CONDITIONS names that neuron",
  );
});

Deno.test("Issue #3848: principle 3 — an edge lost with its removed source is not a violation", () => {
  const before = Creature.fromJSON(graftedIfForest(), false).exportJSON();
  const after = structuredClone(before);

  // `relay-ident` feeds if-0-root's condition. Removing the relay must take its
  // edge with it, and that is answering a rule rather than rewiring an IF.
  after.neurons = after.neurons.filter((n) => n.uuid !== "relay-ident");
  after.synapses = after.synapses.filter(
    (s) => s.fromUUID !== "relay-ident" && s.toUUID !== "relay-ident",
  );

  assertEquals(
    findRoleRewiring(before, after, new Set()).length,
    0,
    "the edge could not have been left where it was",
  );
});

Deno.test("Issue #3848: principle 3 — a clean repair of a grafted forest raises no violation", () => {
  const before = Creature.fromJSON(graftedForestWithStrandedConstant(), false)
    .exportJSON();
  const after = Upgrade.correct(structuredClone(before), before.input)
    .exportJSON();

  assertEquals(
    findRoleRewiring(before, after, new Set()),
    [],
    "removing a stranded constant touches no IF at all",
  );
});

Deno.test("Issue #3848: principle 1 — a result that lost the creature's outputs is refused", async () => {
  await initWasmForTests();

  const healthy = Creature.fromJSON(graftedIfForest(), false);
  const baseline = captureBehaviourBaseline(healthy);
  assert(baseline, "the fixture activates, so it has a contract to hold");

  // Same probe rows, a creature that cannot answer them in the same shape.
  const reshaped = Creature.fromJSON(pointWiseCreature(), false);
  reshaped.output = 2;

  let refusal: unknown;
  try {
    assertBehaviourNotLost(reshaped, baseline, "test");
  } catch (e) {
    refusal = e;
  }
  assert(refusal instanceof RepairError, "a lost output shape must be refused");
  assertEquals(refusal.reason, "BEHAVIOUR_LOST");

  // The healthy creature is of course still accepted against its own baseline.
  assertBehaviourNotLost(healthy, baseline, "test");
});

Deno.test("Issue #3848: a creature no repair can rescue fails loud rather than returning", () => {
  // A stale `neuron.index` cache: no rule-driven repair covers it, so the pass
  // falls back to the legacy `Creature.fix()` — which does not resolve it
  // either. The creature must then throw rather than be handed back invalid.
  const creature = Creature.fromJSON(pointWiseCreature(), false);
  creature.neurons[creature.input].index = 99;

  let failure: unknown;
  try {
    verifiedRepair(creature, { pass: "test" });
  } catch (e) {
    failure = e;
  }

  assert(
    failure instanceof ValidationError,
    "an unrecoverable creature must throw, not be returned as repaired",
  );
  assertEquals(failure.reason, "OTHER");
  assertStringIncludes(failure.message, "does not match expected index");
});
