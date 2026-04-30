/**
 * Tests for the DnaSharingStrategy interface and bake-off harness.
 *
 * Issue #2491: Verifies the strategy interface contract — a fake strategy
 * is invoked with the recipient/donor/options the harness was given,
 * returns, and the harness records its row. Also verifies the NoOp baseline,
 * shared-UUID counting, and Markdown formatting.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import {
  countSharedHiddenUuids,
  type DnaSharingPrepareOptions,
  type DnaSharingStrategy,
  formatBakeOffMarkdown,
  NoOpStrategy,
  runBakeOff,
} from "@transfer/mod.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

function buildProbe(): DataRecordInterface[] {
  return [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];
}

Deno.test("runBakeOff - fake strategy is invoked with harness options and recorded", async () => {
  await initWasmForTests();

  const recipient = new Creature(2, 1, { layers: [{ count: 3 }] });
  const donor = new Creature(2, 1, { layers: [{ count: 2 }] });

  const captured: {
    prepareCalls: number;
    seenSeed?: number;
    seenGenerations?: number;
    sawRecipient: boolean;
    sawDonor: boolean;
  } = { prepareCalls: 0, sawRecipient: false, sawDonor: false };

  const fakeStrategy: DnaSharingStrategy = {
    name: "Fake",
    prepare(
      r: Creature,
      d: Creature,
      o: DnaSharingPrepareOptions,
    ): Promise<void> {
      captured.prepareCalls++;
      captured.seenSeed = o.seed;
      captured.seenGenerations = o.generations;
      captured.sawRecipient = r instanceof Creature;
      captured.sawDonor = d instanceof Creature;
      return Promise.resolve();
    },
  };

  const rows = await runBakeOff({
    recipient: recipient.exportJSON(),
    donor: donor.exportJSON(),
    probe: buildProbe(),
    strategies: [fakeStrategy],
    generations: 7,
    seed: 1234,
  });

  assertEquals(
    rows.length,
    1,
    "harness must record exactly one row per strategy",
  );
  assertEquals(rows[0].name, "Fake");
  assertEquals(captured.prepareCalls, 1, "prepare must be called once");
  assertEquals(captured.seenSeed, 1234, "harness must pass seed through");
  assertEquals(
    captured.seenGenerations,
    7,
    "harness must pass generation budget through",
  );
  assert(captured.sawRecipient, "recipient must be a Creature instance");
  assert(captured.sawDonor, "donor must be a Creature instance");

  const row = rows[0];
  assert(Number.isFinite(row.baselineScore), "baselineScore must be finite");
  assert(Number.isFinite(row.finalScore), "finalScore must be finite");
  assertEquals(row.lift, row.finalScore - row.baselineScore);
  assert(row.neurons > 0, "neurons must be reported");
  assert(row.synapses > 0, "synapses must be reported");
  assert(row.durationMs >= 0, "durationMs must be non-negative");
});

Deno.test("runBakeOff - NoOpStrategy produces zero lift", async () => {
  await initWasmForTests();

  const recipient = new Creature(2, 1, { layers: [{ count: 3 }] });
  const donor = new Creature(2, 1, { layers: [{ count: 2 }] });

  const rows = await runBakeOff({
    recipient: recipient.exportJSON(),
    donor: donor.exportJSON(),
    probe: buildProbe(),
    strategies: [new NoOpStrategy()],
    generations: 1,
    seed: 42,
  });

  assertEquals(rows.length, 1);
  assertEquals(rows[0].name, "NoOp");
  assertEquals(rows[0].lift, 0, "NoOp must not move the score");
  assertEquals(
    rows[0].baselineScore,
    rows[0].finalScore,
    "baseline and final must match for NoOp",
  );
});

Deno.test("runBakeOff - rows preserve strategy order", async () => {
  await initWasmForTests();

  const recipient = new Creature(2, 1, { layers: [{ count: 2 }] });
  const donor = new Creature(2, 1, { layers: [{ count: 2 }] });

  const order = ["A", "B", "C"];
  const strategies: DnaSharingStrategy[] = order.map((name) => ({
    name,
    prepare: () => Promise.resolve(),
  }));

  const rows = await runBakeOff({
    recipient: recipient.exportJSON(),
    donor: donor.exportJSON(),
    probe: buildProbe(),
    strategies,
    generations: 1,
    seed: 0,
  });

  assertEquals(rows.map((r) => r.name), order);
});

Deno.test("runBakeOff - custom evolveStep is invoked and result is recorded", async () => {
  await initWasmForTests();

  const recipient = new Creature(2, 1, { layers: [{ count: 2 }] });
  const donor = new Creature(2, 1, { layers: [{ count: 2 }] });

  let evolveCalls = 0;
  const rows = await runBakeOff({
    recipient: recipient.exportJSON(),
    donor: donor.exportJSON(),
    probe: buildProbe(),
    strategies: [new NoOpStrategy()],
    generations: 5,
    seed: 9,
    evolveStep: (_recipient, _probe, gens, seed) => {
      evolveCalls++;
      // Confirm the harness forwarded both shared knobs to the hook.
      assertEquals(gens, 5);
      assertEquals(seed, 9);
      return 0.25;
    },
  });

  assertEquals(evolveCalls, 1, "evolveStep must be called once per strategy");
  assertEquals(
    rows[0].finalScore,
    0.25,
    "harness must record the hook's result",
  );
});

Deno.test("countSharedHiddenUuids - counts donor hidden UUIDs present in recipient", async () => {
  await initWasmForTests();

  const recipient = new Creature(2, 1, { layers: [{ count: 3 }] });
  const donor = new Creature(2, 1, { layers: [{ count: 3 }] });

  // No shared hidden neurons — distinct creatures get distinct UUIDs.
  assertEquals(countSharedHiddenUuids(recipient, donor), 0);

  // Force one donor UUID into the recipient and confirm the count.
  const donorHidden = donor.neurons.filter((n) => n.type === "hidden");
  assert(donorHidden.length > 0, "donor must have hidden neurons");
  const recipientHidden = recipient.neurons.filter((n) => n.type === "hidden");
  assert(recipientHidden.length > 0, "recipient must have hidden neurons");
  recipientHidden[0].uuid = donorHidden[0].uuid;

  assertEquals(countSharedHiddenUuids(recipient, donor), 1);
});

Deno.test("formatBakeOffMarkdown - emits header, separator, and one row per result", () => {
  const md = formatBakeOffMarkdown([
    {
      name: "NoOp",
      baselineScore: -0.5,
      finalScore: -0.5,
      lift: 0,
      hiddenUuidsShared: 0,
      neurons: 4,
      synapses: 7,
      durationMs: 12.34,
    },
    {
      name: "Fake",
      baselineScore: -0.5,
      finalScore: -0.25,
      lift: 0.25,
      hiddenUuidsShared: 2,
      neurons: 5,
      synapses: 9,
      durationMs: 56.78,
    },
  ]);

  const lines = md.split("\n");
  assertEquals(lines.length, 4, "header + separator + 2 rows");
  assert(lines[0].includes("Strategy"));
  assert(lines[0].includes("Hidden UUIDs Shared"));
  assert(lines[1].startsWith("| ---"));
  assert(lines[2].includes("NoOp"));
  assert(lines[3].includes("Fake"));
  assert(lines[3].includes("0.250000"));
});
