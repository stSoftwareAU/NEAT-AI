import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { Upgrade } from "@reconstruct/Upgrade.ts";
import {
  describeDeviation,
  isExactBehaviourPreserved,
  measureBehaviourDeviation,
} from "@architecture/BehaviourGuard.ts";
import { auditRepair, describeRepairAudit } from "@repair/RepairAudit.ts";
import { structuralFamilies } from "../fixtures/StructuralFamilies.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #3848, principle 6 — *prove it on the shapes you actually receive*.
 *
 * The repair pass that cost a champion 90.7 % of its score was written for
 * v1.x/v2.x creatures and its fixtures were all of that shape. Grafted `IF`
 * forests arrived years later and were never in them, so nothing failed when
 * the pass mangled one.
 *
 * This is the standing test that closes that gap: one fixture per structural
 * family NEAT-AI produces, every one of them valid, and every one of them
 * asserted to survive both ingest paths structurally identical and behaviourally
 * exact. A new family is a new fixture in
 * `test/fixtures/StructuralFamilies.ts` — not a new heuristic here.
 */

function assertUntouched(
  name: string,
  before: CreatureExport,
  after: CreatureExport,
  path: string,
): void {
  const audit = auditRepair(before, after);
  assertEquals(
    audit.synapsesRemoved.length,
    0,
    `${name}: ${path} removed synapses — ${describeRepairAudit(audit)}`,
  );
  assertEquals(
    audit.synapsesAdded.length,
    0,
    `${name}: ${path} added synapses — ${describeRepairAudit(audit)}`,
  );
  assertEquals(
    audit.weightsChanged.length,
    0,
    `${name}: ${path} changed weights — ${describeRepairAudit(audit)}`,
  );
  assertEquals(
    audit.neuronsRemoved.length,
    0,
    `${name}: ${path} removed neurons — ${describeRepairAudit(audit)}`,
  );
  assertEquals(
    audit.neuronsAdded.length,
    0,
    `${name}: ${path} added neurons — ${describeRepairAudit(audit)}`,
  );
  assertEquals(
    audit.neuronsAltered.length,
    0,
    `${name}: ${path} altered neurons — ${describeRepairAudit(audit)}`,
  );
}

Deno.test("Issue #3848: every structural family is valid to begin with", () => {
  for (const { name, json } of structuralFamilies()) {
    const creature = Creature.fromJSON(structuredClone(json), false);
    creatureValidate(creature);
    assert(
      creature.neurons.length > creature.input,
      `${name}: the fixture must carry computational neurons`,
    );
  }
});

Deno.test("Issue #3848: every structural family round-trips both ingest paths untouched", () => {
  for (const { name, json } of structuralFamilies()) {
    const before = Creature.fromJSON(structuredClone(json), false).exportJSON();

    assertUntouched(
      name,
      before,
      Upgrade.correct(structuredClone(before), before.input).exportJSON(),
      "Upgrade.correct()",
    );
    assertUntouched(
      name,
      before,
      Creature.fromPersistedJSON(structuredClone(before)).exportJSON(),
      "Creature.fromPersistedJSON()",
    );
  }
});

Deno.test("Issue #3848: every structural family computes exactly what it did before the load", async () => {
  await initWasmForTests();

  for (const { name, json } of structuralFamilies()) {
    const before = Creature.fromJSON(structuredClone(json), false);
    const after = Upgrade.correct(
      Creature.fromJSON(structuredClone(json), false).exportJSON(),
      json.input,
    );

    const deviation = measureBehaviourDeviation(before, after);
    assert(
      isExactBehaviourPreserved(deviation),
      `${name}: the load path moved the outputs of a valid creature — ${
        describeDeviation(deviation)
      }`,
    );
  }
});

Deno.test("Issue #3848: widening the input count leaves every family untouched", () => {
  for (const { name, json } of structuralFamilies()) {
    const before = Creature.fromJSON(structuredClone(json), false).exportJSON();
    const widened = Upgrade.correct(structuredClone(before), before.input + 3);

    assertEquals(
      widened.input,
      before.input + 3,
      `${name}: the input count must widen`,
    );
    assertUntouched(
      name,
      before,
      widened.exportJSON(),
      "Upgrade.correct() while widening",
    );
  }
});
