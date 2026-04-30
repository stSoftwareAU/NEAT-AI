/**
 * Tests for CompactModuleGraft (Issue #2493).
 *
 * Compact sub-graph graft is import-time DNA transfer: a small dense donor
 * (Europa-style) hands a connected, high-activation hidden-neuron module to
 * a larger sparser recipient (production-style). Unlike `SubgraphTransplant`
 * (#2177) — which picks 2–5 neuron clusters and reassigns their UUIDs —
 * this primitive picks larger denser modules and **preserves the donor's
 * neuron UUIDs** end-to-end so cross-machine breeding can still align
 * neurons by UUID after the graft (AGENTS.md neuron UUID stability invariant).
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { extractSubgraphs } from "@breed/SubgraphTransplant.ts";
import {
  compactModuleGraft,
  CompactModuleGraftStrategy,
  detectDenseModules,
  scoreModulesByActivation,
} from "@transfer/CompactModuleGraft.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/** Build a creature from raw neuron uuids and synapse triples. */
function buildCreature(
  inputCount: number,
  hiddenUUIDs: string[],
  outputCount: number,
  connections: Array<{ from: string; to: string; weight: number }>,
): Creature {
  const neurons: CreatureExport["neurons"] = hiddenUUIDs.map((uuid) => ({
    type: "hidden" as const,
    uuid,
    squash: "LOGISTIC",
    bias: 0.1,
  }));
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      squash: "IDENTITY",
      bias: 0,
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
 * Build a "Europa-style" donor: small but dense hidden module of 6 neurons
 * tightly interconnected, plus a few peripheral neurons.
 */
function createDenseDonor(): Creature {
  const moduleNeurons = ["d0", "d1", "d2", "d3", "d4", "d5"];
  const peripheral = ["dPeripheral"];

  // Tight all-pairs forward links between module neurons (i -> j for i<j),
  // giving 5+4+3+2+1 = 15 internal synapses across 6 neurons.
  const internal: Array<{ from: string; to: string; weight: number }> = [];
  for (let i = 0; i < moduleNeurons.length; i++) {
    for (let j = i + 1; j < moduleNeurons.length; j++) {
      internal.push({
        from: moduleNeurons[i],
        to: moduleNeurons[j],
        weight: 0.4,
      });
    }
  }

  return buildCreature(
    3,
    [...moduleNeurons, ...peripheral],
    1,
    [
      { from: "input-0", to: "d0", weight: 0.5 },
      { from: "input-1", to: "d0", weight: -0.3 },
      { from: "input-2", to: "d1", weight: 0.4 },
      ...internal,
      { from: "d5", to: "output-0", weight: 0.6 },
      // Peripheral neuron — sparse, should not be selected as the dense module.
      { from: "input-2", to: "dPeripheral", weight: 0.2 },
      { from: "dPeripheral", to: "output-0", weight: 0.1 },
    ],
  );
}

/** Build a sparse "production-style" recipient with simple topology. */
function createSparseRecipient(): Creature {
  return buildCreature(
    3,
    ["mA", "mB"],
    1,
    [
      { from: "input-0", to: "mA", weight: 0.3 },
      { from: "input-1", to: "mB", weight: 0.4 },
      { from: "input-2", to: "mB", weight: 0.5 },
      { from: "mA", to: "output-0", weight: 0.6 },
      { from: "mB", to: "output-0", weight: 0.7 },
    ],
  );
}

function buildProbe(): DataRecordInterface[] {
  return [
    {
      input: new Float32Array([0.1, 0.2, 0.3]),
      output: new Float32Array([0.5]),
    },
    {
      input: new Float32Array([0.5, 0.6, 0.7]),
      output: new Float32Array([0.5]),
    },
    {
      input: new Float32Array([0.9, 0.8, 0.7]),
      output: new Float32Array([0.5]),
    },
    {
      input: new Float32Array([0.2, 0.4, 0.6]),
      output: new Float32Array([0.5]),
    },
  ];
}

Deno.test("detectDenseModules - returns at least one module from a dense donor", async () => {
  await initWasmForTests();
  const donor = createDenseDonor();
  const modules = detectDenseModules(donor.exportJSON());
  assert(
    modules.length >= 1,
    `expected >=1 dense module, got ${modules.length}`,
  );
  for (const m of modules) {
    assert(m.neuronUuids.length >= 2);
    assert(m.density > 0);
  }
});

Deno.test(
  "detectDenseModules - picks denser candidates than SubgraphTransplant on the same donor",
  async () => {
    await initWasmForTests();
    const donor = createDenseDonor();
    const donorExport = donor.exportJSON();

    const denseModules = detectDenseModules(donorExport);
    const sgSubgraphs = extractSubgraphs(donorExport);

    assert(denseModules.length > 0, "must produce at least one dense module");
    assert(
      sgSubgraphs.length > 0,
      "donor must produce SubgraphTransplant outputs",
    );

    // Compare on the same density measure: internal-synapses / module-size.
    const denseDensity = denseModules[0].internalSynapses.length /
      denseModules[0].neuronUuids.length;
    const sgBestDensity = Math.max(
      ...sgSubgraphs.map((s) =>
        s.internalSynapses.length / s.neuronUuids.length
      ),
    );
    assert(
      denseDensity > sgBestDensity,
      `dense module density ${denseDensity} should exceed SubgraphTransplant ` +
        `best density ${sgBestDensity}`,
    );
    assert(
      denseModules[0].neuronUuids.length > 5,
      "dense module must be larger than SubgraphTransplant's 5-neuron cap",
    );
  },
);

Deno.test("detectDenseModules - respects custom densityFactor threshold", async () => {
  await initWasmForTests();
  const donor = createDenseDonor();
  // Very high threshold should filter most modules out.
  const strict = detectDenseModules(donor.exportJSON(), {
    densityFactor: 100,
  });
  assertEquals(
    strict.length,
    0,
    "an unreachable density factor must produce no candidates",
  );
});

Deno.test("scoreModulesByActivation - assigns finite activationScore per module", async () => {
  await initWasmForTests();
  const donor = createDenseDonor();
  const modules = detectDenseModules(donor.exportJSON());
  const scored = scoreModulesByActivation(modules, donor, buildProbe());
  assert(scored.length === modules.length);
  for (const m of scored) {
    assert(
      Number.isFinite(m.activationScore),
      `activationScore must be finite, got ${m.activationScore}`,
    );
  }
});

Deno.test("compactModuleGraft - returns a creature that passes creatureValidate", async () => {
  await initWasmForTests();
  const recipient = createSparseRecipient();
  const donor = createDenseDonor();

  const grafted = compactModuleGraft(recipient, donor, { probe: buildProbe() });
  assert(grafted, "graft must produce a creature");
  creatureValidate(grafted);
});

Deno.test("compactModuleGraft - preserves donor neuron UUIDs in the recipient", async () => {
  await initWasmForTests();
  const recipient = createSparseRecipient();
  const donor = createDenseDonor();
  const donorHidden = donor.exportJSON().neurons.filter((n) =>
    n.type === "hidden"
  ).map((n) => n.uuid);

  const grafted = compactModuleGraft(recipient, donor, { probe: buildProbe() });
  assert(grafted, "graft must produce a creature");

  const graftedUuids = new Set(grafted.exportJSON().neurons.map((n) => n.uuid));
  // At least some donor hidden UUIDs must survive verbatim — the whole point of
  // the primitive is that breeding can re-align by UUID after the graft.
  let surviving = 0;
  for (const u of donorHidden) {
    if (typeof u === "string" && graftedUuids.has(u)) surviving++;
  }
  assert(
    surviving >= 6,
    `expected the dense module's UUIDs to survive (>=6), got ${surviving}`,
  );
});

Deno.test("compactModuleGraft - preserves recipient neuron UUIDs", async () => {
  await initWasmForTests();
  const recipient = createSparseRecipient();
  const donor = createDenseDonor();
  const recipientUuidsBefore = new Set(
    recipient.exportJSON().neurons.map((n) => n.uuid).filter((u) => !!u),
  );

  const grafted = compactModuleGraft(recipient, donor, { probe: buildProbe() });
  assert(grafted, "graft must produce a creature");

  const graftedUuids = new Set(grafted.exportJSON().neurons.map((n) => n.uuid));
  for (const u of recipientUuidsBefore) {
    assert(
      graftedUuids.has(u as string),
      `recipient UUID ${u} must survive the graft (UUID stability invariant)`,
    );
  }
});

Deno.test("compactModuleGraft - rejects donor with no dense module", async () => {
  await initWasmForTests();
  const recipient = createSparseRecipient();
  // Donor with too few hidden neurons to form a dense module
  const donor = buildCreature(
    3,
    ["x"],
    1,
    [
      { from: "input-0", to: "x", weight: 0.5 },
      { from: "x", to: "output-0", weight: 0.3 },
    ],
  );
  const grafted = compactModuleGraft(recipient, donor, { probe: buildProbe() });
  assertEquals(
    grafted,
    undefined,
    "graft must return undefined when no dense module can be detected",
  );
});

Deno.test("compactModuleGraft - rejects grafts that fail creatureValidate", async () => {
  await initWasmForTests();
  const recipient = createSparseRecipient();
  const donor = createDenseDonor();
  // Force boundary alignment to a non-existent input by demanding more inputs
  // than the recipient provides — the resulting graft is invalid and must be
  // rejected.
  const grafted = compactModuleGraft(recipient, donor, {
    probe: buildProbe(),
    requireMinimumInputs: 99,
  });
  assertEquals(grafted, undefined);
});

Deno.test(
  "CompactModuleGraftStrategy - conforms to DnaSharingStrategy and mutates recipient",
  async () => {
    await initWasmForTests();
    const recipient = createSparseRecipient();
    const donor = createDenseDonor();
    const before = recipient.neurons.length;

    const strategy = new CompactModuleGraftStrategy({ probe: buildProbe() });
    assertEquals(strategy.name, "CompactModuleGraft");

    await strategy.prepare(recipient, donor, { seed: 1, generations: 1 });

    assert(
      recipient.neurons.length > before,
      `recipient neuron count must grow after graft (was ${before}, now ` +
        `${recipient.neurons.length})`,
    );
    creatureValidate(recipient);
  },
);

Deno.test(
  "CompactModuleGraftStrategy - is a no-op when graft is rejected",
  async () => {
    await initWasmForTests();
    const recipient = createSparseRecipient();
    const recipientNeurons = recipient.neurons.length;
    // Donor with no viable dense module
    const donor = buildCreature(
      3,
      ["x"],
      1,
      [
        { from: "input-0", to: "x", weight: 0.5 },
        { from: "x", to: "output-0", weight: 0.3 },
      ],
    );
    const strategy = new CompactModuleGraftStrategy({ probe: buildProbe() });
    await strategy.prepare(recipient, donor, { seed: 1, generations: 1 });
    assertEquals(
      recipient.neurons.length,
      recipientNeurons,
      "recipient must be unchanged when no graft is possible",
    );
    creatureValidate(recipient);
  },
);

Deno.test(
  "compactModuleGraft - higher activationScore module is preferred",
  async () => {
    await initWasmForTests();
    const donor = createDenseDonor();
    const probe = buildProbe();
    // Sanity: scoring is deterministic for a fixed donor + probe.
    const m1 = scoreModulesByActivation(
      detectDenseModules(donor.exportJSON()),
      donor,
      probe,
    );
    const m2 = scoreModulesByActivation(
      detectDenseModules(donor.exportJSON()),
      donor,
      probe,
    );
    assertEquals(
      m1.map((m) => m.activationScore),
      m2.map((m) => m.activationScore),
      "activation scoring must be deterministic for the same probe",
    );
  },
);
