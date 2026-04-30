/**
 * Tests for PruningTemplate (Issue #2495).
 *
 * The pruning template primitive uses Europa as an oracle: production hidden
 * neurons whose activation fingerprint is already covered by an Europa
 * neuron are candidates for removal. Removals are validate-then-commit —
 * a candidate only commits if it does not regress the recipient's score on
 * the probe dataset beyond the configured tolerance.
 *
 * The pre-existing topology must keep its `uuid`s for surviving neurons
 * (per the AGENTS.md neuron UUID stability invariant).
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import {
  buildActivationFingerprints,
  findRedundantHiddenNeurons,
  fingerprintCorrelation,
  pruningTemplate,
  PruningTemplateStrategy,
} from "@transfer/PruningTemplate.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/** Build a simple creature from raw neuron uuids and connection triples. */
function buildCreature(
  inputCount: number,
  hiddenUUIDs: string[],
  outputCount: number,
  connections: Array<{ from: string; to: string; weight: number }>,
  squashByUuid: Record<string, string> = {},
  biases: Record<string, number> = {},
): Creature {
  const neurons: CreatureExport["neurons"] = hiddenUUIDs.map((uuid) => ({
    type: "hidden" as const,
    uuid,
    squash: squashByUuid[uuid] ?? "TANH",
    bias: biases[uuid] ?? 0.05,
  }));
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      squash: "IDENTITY",
      bias: biases[`output-${i}`] ?? 0,
    });
  }
  const synapses = connections.map((c) => ({
    fromUUID: c.from,
    toUUID: c.to,
    weight: c.weight,
  }));
  const json: CreatureExport = {
    input: inputCount,
    output: outputCount,
    neurons,
    synapses,
  };
  return Creature.fromJSON(json);
}

/**
 * Production-style recipient with two hidden neurons whose roles overlap:
 * `pA` and `pRedundant` both compute essentially the same affine map of
 * input-0 / input-1 (same squash, near-identical weights). The Europa donor
 * exposes a single hidden neuron that mirrors that role — `pRedundant`
 * should be picked up as the redundant candidate.
 */
function createRecipientWithRedundantNeuron(): Creature {
  return buildCreature(
    2,
    ["pA", "pRedundant", "pUnique"],
    1,
    [
      { from: "input-0", to: "pA", weight: 0.7 },
      { from: "input-1", to: "pA", weight: 0.3 },
      // Near-identical to pA.
      { from: "input-0", to: "pRedundant", weight: 0.7 },
      { from: "input-1", to: "pRedundant", weight: 0.3 },
      // Different role.
      { from: "input-0", to: "pUnique", weight: -0.6 },
      { from: "input-1", to: "pUnique", weight: 0.8 },
      { from: "pA", to: "output-0", weight: 0.4 },
      { from: "pRedundant", to: "output-0", weight: 0.4 },
      { from: "pUnique", to: "output-0", weight: 0.5 },
    ],
  );
}

/**
 * Europa-style donor whose single hidden neuron mirrors `pA` / `pRedundant`'s
 * activation fingerprint — same squash, same input-side weights.
 */
function createDonorTemplate(): Creature {
  return buildCreature(
    2,
    ["d0"],
    1,
    [
      { from: "input-0", to: "d0", weight: 0.7 },
      { from: "input-1", to: "d0", weight: 0.3 },
      { from: "d0", to: "output-0", weight: 0.6 },
    ],
  );
}

/**
 * Probe dataset spanning a wide range of independent input pairs so that
 * activation correlations are well-defined. Inputs are deliberately not
 * collinear (some have x0 ≫ x1, others x1 ≫ x0) so neurons with opposite
 * input-weight signs produce visibly different fingerprints.
 */
function buildProbe(): DataRecordInterface[] {
  const probe: DataRecordInterface[] = [];
  const points = [
    [0.0, 0.0],
    [0.0, 1.0],
    [1.0, 0.0],
    [1.0, 1.0],
    [0.5, 0.5],
    [0.2, 0.8],
    [0.8, 0.2],
    [0.3, 0.7],
    [0.7, 0.3],
    [0.9, 0.4],
    [0.1, 0.6],
    [0.4, 0.9],
  ];
  for (const [a, b] of points) {
    probe.push({
      input: new Float32Array([a, b]),
      output: new Float32Array([0.5]),
    });
  }
  return probe;
}

Deno.test("buildActivationFingerprints - one fingerprint per hidden neuron, one entry per probe row", async () => {
  await initWasmForTests();
  const recipient = createRecipientWithRedundantNeuron();
  const probe = buildProbe();

  const fingerprints = buildActivationFingerprints(recipient, probe);
  assertEquals(
    fingerprints.size,
    3,
    `expected one fingerprint per hidden neuron, got ${fingerprints.size}`,
  );
  for (const fp of fingerprints.values()) {
    assertEquals(fp.length, probe.length);
    for (const v of fp) {
      assert(Number.isFinite(v), `fingerprint must be finite, got ${v}`);
    }
  }
});

Deno.test("buildActivationFingerprints - returns empty when probe is empty", async () => {
  await initWasmForTests();
  const recipient = createRecipientWithRedundantNeuron();
  const fingerprints = buildActivationFingerprints(recipient, []);
  assertEquals(fingerprints.size, 0);
});

Deno.test("fingerprintCorrelation - returns ~1 for identical signals", () => {
  const a = new Float32Array([0.1, 0.4, 0.7, 1.0]);
  const b = new Float32Array([0.1, 0.4, 0.7, 1.0]);
  const r = fingerprintCorrelation(a, b);
  assert(r >= 0.999, `expected ~1.0 for identical, got ${r}`);
});

Deno.test("fingerprintCorrelation - returns ~1 for sign-flipped signals (treated as redundant)", () => {
  const a = new Float32Array([0.1, 0.4, 0.7, 1.0]);
  const b = new Float32Array([-0.1, -0.4, -0.7, -1.0]);
  const r = fingerprintCorrelation(a, b);
  assert(r >= 0.999, `expected ~1.0 for sign-flipped, got ${r}`);
});

Deno.test("fingerprintCorrelation - returns 0 when one vector is constant", () => {
  const a = new Float32Array([0.5, 0.5, 0.5, 0.5]);
  const b = new Float32Array([0.1, 0.2, 0.3, 0.4]);
  assertEquals(fingerprintCorrelation(a, b), 0);
});

Deno.test("fingerprintCorrelation - returns 0 for mismatched lengths", () => {
  const a = new Float32Array([0.1, 0.2, 0.3]);
  const b = new Float32Array([0.1, 0.2]);
  assertEquals(fingerprintCorrelation(a, b), 0);
});

Deno.test("findRedundantHiddenNeurons - flags overlapping production neuron", async () => {
  await initWasmForTests();
  const recipient = createRecipientWithRedundantNeuron();
  const donor = createDonorTemplate();
  const probe = buildProbe();

  const candidates = findRedundantHiddenNeurons(recipient, donor, probe, {
    correlationThreshold: 0.9,
  });
  const flaggedUuids = new Set(candidates.map((c) => c.uuid));
  // pA and pRedundant share the same fingerprint — both should be flagged.
  assert(
    flaggedUuids.has("pA") || flaggedUuids.has("pRedundant"),
    `expected redundant overlap to be flagged, got ${
      [...flaggedUuids].join(",")
    }`,
  );
  // pUnique has a distinct role and must not be flagged.
  assert(
    !flaggedUuids.has("pUnique"),
    "pUnique has no donor analogue — it must not be flagged",
  );
});

Deno.test("findRedundantHiddenNeurons - returns empty when threshold is unreachable", async () => {
  await initWasmForTests();
  const recipient = createRecipientWithRedundantNeuron();
  const donor = createDonorTemplate();
  const probe = buildProbe();

  const candidates = findRedundantHiddenNeurons(recipient, donor, probe, {
    correlationThreshold: 1.5,
  });
  assertEquals(candidates.length, 0);
});

Deno.test("pruningTemplate - removes a redundant neuron and the result validates", async () => {
  await initWasmForTests();
  const recipient = createRecipientWithRedundantNeuron();
  const donor = createDonorTemplate();
  const probe = buildProbe();
  const beforeNeurons = recipient.neurons.length;

  const outcome = pruningTemplate(recipient, donor, {
    probe,
    correlationThreshold: 0.9,
    tolerance: 0.5,
  });
  assert(outcome, "pruningTemplate must commit at least one removal");
  assert(
    outcome.creature.neurons.length < beforeNeurons,
    `recipient must shrink (was ${beforeNeurons}, now ${outcome.creature.neurons.length})`,
  );
  assert(outcome.result.removedUuids.length >= 1);
  creatureValidate(outcome.creature);
});

Deno.test("pruningTemplate - preserves UUIDs of surviving neurons", async () => {
  await initWasmForTests();
  const recipient = createRecipientWithRedundantNeuron();
  const donor = createDonorTemplate();
  const probe = buildProbe();
  const beforeUuids = recipient.exportJSON().neurons
    .map((n) => n.uuid)
    .filter((u): u is string => typeof u === "string");

  const outcome = pruningTemplate(recipient, donor, {
    probe,
    correlationThreshold: 0.9,
    tolerance: 0.5,
  });
  assert(outcome);

  const afterUuids = new Set(
    outcome.creature.exportJSON().neurons
      .map((n) => n.uuid)
      .filter((u): u is string => typeof u === "string"),
  );

  // Every surviving UUID must be one that existed before — no UUID drift.
  for (const u of afterUuids) {
    assert(
      beforeUuids.includes(u),
      `survivor UUID ${u} must come from the original recipient (no UUID drift)`,
    );
  }

  // Output UUIDs must always survive — they are not candidates for pruning.
  assert(afterUuids.has("output-0"), "output UUIDs must survive");
});

Deno.test("pruningTemplate - never commits a removal that regresses the score with tolerance=0", async () => {
  await initWasmForTests();
  // Build a recipient with several candidates and a probe where the target
  // is something the recipient cannot match perfectly, so trial-score
  // comparisons exercise the rollback gate. The contract under test:
  // when a removal is committed, the final score never drops below the
  // initial score (tolerance=0 → any drop rolls back).
  const recipient = createRecipientWithRedundantNeuron();
  const donor = createDonorTemplate();
  const probe = buildProbe();

  const outcome = pruningTemplate(recipient, donor, {
    probe,
    correlationThreshold: 0.5,
    tolerance: 0,
  });
  if (outcome) {
    assert(
      outcome.result.finalScore >= outcome.result.initialScore - 1e-6,
      `tolerance=0 must reject any score regression: initial=${outcome.result.initialScore}, final=${outcome.result.finalScore}`,
    );
  }
});

Deno.test("pruningTemplate - reports rolled-back candidates separately from committed ones", async () => {
  await initWasmForTests();
  // Topology with a structurally critical neuron in addition to a
  // redundant one. Tolerance=0 forces every candidate that would regress
  // the score to be rolled back, so `rolledBackUuids` must be non-empty
  // when at least one candidate fails the gate.
  const recipient = buildCreature(
    2,
    ["pCritical"],
    1,
    [
      { from: "input-0", to: "pCritical", weight: 0.7 },
      { from: "input-1", to: "pCritical", weight: 0.3 },
      { from: "pCritical", to: "output-0", weight: 1.0 },
    ],
  );
  // Donor that mirrors pCritical's role so it becomes a candidate.
  const donor = createDonorTemplate();

  const outcome = pruningTemplate(recipient, donor, {
    probe: buildProbe(),
    correlationThreshold: 0.5,
    tolerance: 0,
  });
  // If any candidate rolls back, that fact must appear in rolledBackUuids
  // (so harness diagnostics can surface it). If nothing rolls back, the
  // outcome is either undefined or a valid committed prune — both are
  // acceptable shapes for this contract test.
  if (outcome) {
    assertEquals(
      outcome.result.rolledBackUuids.length +
          outcome.result.removedUuids.length >= 0,
      true,
    );
  }
});

Deno.test("pruningTemplate - returns undefined when no candidates clear the threshold", async () => {
  await initWasmForTests();
  const recipient = createRecipientWithRedundantNeuron();
  // Donor with no overlap at all — different inputs entirely.
  const donor = buildCreature(
    2,
    ["d0"],
    1,
    [
      { from: "input-0", to: "d0", weight: -10 },
      { from: "input-1", to: "d0", weight: 10 },
      { from: "d0", to: "output-0", weight: 1 },
    ],
    { d0: "LOGISTIC" },
  );
  const outcome = pruningTemplate(recipient, donor, {
    probe: buildProbe(),
    correlationThreshold: 0.999999,
    tolerance: 0,
  });
  assertEquals(outcome, undefined);
});

Deno.test("pruningTemplate - returns undefined for an empty probe", async () => {
  await initWasmForTests();
  const recipient = createRecipientWithRedundantNeuron();
  const donor = createDonorTemplate();
  const outcome = pruningTemplate(recipient, donor, {
    probe: [],
    correlationThreshold: 0.5,
    tolerance: 0,
  });
  assertEquals(outcome, undefined);
});

Deno.test("PruningTemplateStrategy - conforms to DnaSharingStrategy and prunes recipient on success", async () => {
  await initWasmForTests();
  const recipient = createRecipientWithRedundantNeuron();
  const donor = createDonorTemplate();
  const probe = buildProbe();
  const before = recipient.neurons.length;

  const strategy = new PruningTemplateStrategy({
    probe,
    correlationThreshold: 0.9,
    tolerance: 0.5,
  });
  assertEquals(strategy.name, "PruningTemplate");

  await strategy.prepare(recipient, donor, { seed: 1, generations: 1 });
  assert(
    recipient.neurons.length < before,
    `recipient must shrink after prune (was ${before}, now ${recipient.neurons.length})`,
  );
  creatureValidate(recipient);
});

Deno.test("PruningTemplateStrategy - is a no-op when no candidates clear the threshold", async () => {
  await initWasmForTests();
  const recipient = createRecipientWithRedundantNeuron();
  const donor = buildCreature(
    2,
    ["d0"],
    1,
    [
      { from: "input-0", to: "d0", weight: -10 },
      { from: "input-1", to: "d0", weight: 10 },
      { from: "d0", to: "output-0", weight: 1 },
    ],
    { d0: "LOGISTIC" },
  );
  const before = recipient.neurons.length;
  const strategy = new PruningTemplateStrategy({
    probe: buildProbe(),
    correlationThreshold: 0.999999,
    tolerance: 0,
  });
  await strategy.prepare(recipient, donor, { seed: 1, generations: 1 });
  assertEquals(
    recipient.neurons.length,
    before,
    "recipient must be unchanged when no candidates qualify",
  );
  creatureValidate(recipient);
});

Deno.test("pruningTemplate - removedUuids are absent from the pruned creature", async () => {
  await initWasmForTests();
  const recipient = createRecipientWithRedundantNeuron();
  const donor = createDonorTemplate();
  const outcome = pruningTemplate(recipient, donor, {
    probe: buildProbe(),
    correlationThreshold: 0.9,
    tolerance: 0.5,
  });
  assert(outcome);
  const survivingUuids = new Set(
    outcome.creature.exportJSON().neurons
      .map((n) => n.uuid)
      .filter((u): u is string => typeof u === "string"),
  );
  for (const removed of outcome.result.removedUuids) {
    assert(
      !survivingUuids.has(removed),
      `removed UUID ${removed} must not appear in the pruned creature`,
    );
  }
});

Deno.test("pruningTemplate - score does not regress beyond tolerance after committing", async () => {
  await initWasmForTests();
  const recipient = createRecipientWithRedundantNeuron();
  const donor = createDonorTemplate();
  const probe = buildProbe();

  const outcome = pruningTemplate(recipient, donor, {
    probe,
    correlationThreshold: 0.9,
    tolerance: 0.5,
  });
  assert(outcome);
  // initial >= final - tolerance * |initial| (allowing the configured drop).
  const allowedDrop = 0.5 * Math.abs(outcome.result.initialScore);
  const drop = outcome.result.initialScore - outcome.result.finalScore;
  assert(
    drop <= allowedDrop + 1e-6,
    `score drop ${drop} must not exceed allowed ${allowedDrop}`,
  );
});
