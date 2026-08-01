/**
 * Issue #3612 — fact-check guard for the export banners in `mod.ts`.
 *
 * `mod.ts` is the package's sole `exports` entry point, so its export banners
 * are the first documentation a consumer meets. A cluster of them merely
 * restated the identifier ("Creature Utilities … helpers for working with
 * Creature instances") and three actively misdescribed what they sat above:
 * `NeuronExport`/`SynapseExport` were labelled "Class" though they are
 * interfaces, and `Upgrade` was said to "evolve AI entities" when it repairs
 * creature exports.
 *
 * Each banner now states a contract the signature cannot express. These are
 * "what" tests: every such claim is exercised against the real symbol imported
 * from the public entry point, so the banners cannot silently drift from
 * behaviour. Deliberately not source-text greps over the comment prose —
 * Issue #3142 removed that style because a reword broke the build without any
 * observable change.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  createNeatConfig,
  Creature,
  type CreatureExport,
  CreatureUtil,
  type CrisprInterface,
  Mutation,
  normaliseCreatureExport,
  randomConnectMissing,
  Selection,
  Upgrade,
  upgradeTwo,
} from "../../mod.ts";
import { exportJSONWithRuntimeIds } from "@architecture/PopulateRuntimeIdsFromCreature.ts";
import { createBackPropagationConfig } from "@propagate/BackPropagation.ts";
import { SparseConfig } from "@propagate/sparse/SparseConfig.ts";
import { initWasmForTests } from "../_initWasm.ts";

/** Banner: `CreatureExport` carries no activation state; `CreatureTrace` does. */
Deno.test("mod.ts banner — CreatureTrace adds trace state only after activation", async () => {
  await initWasmForTests();
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });

  for (const neuron of creature.exportJSON().neurons) {
    assert(
      !("trace" in neuron),
      "CreatureExport neurons must not carry trace state",
    );
  }
  assertEquals(
    creature.traceJSON().neurons.some((n) => n.trace !== undefined),
    false,
    "an un-activated creature has no trace state to report",
  );

  const config = createBackPropagationConfig();
  const sparseConfig = new SparseConfig(
    exportJSONWithRuntimeIds(creature),
    config,
  );
  creature.activateAndTrace(
    Float32Array.from([0.5, 0.25]),
    false,
    sparseConfig,
  );
  creature.propagate(Float32Array.from([1]), config, sparseConfig);

  const traced = creature.traceJSON();
  assert(
    traced.neurons.some((n) => n.trace !== undefined),
    "CreatureTrace neurons carry trace state once activated",
  );
  assert(
    traced.synapses.some((s) => s.trace !== undefined),
    "CreatureTrace synapses carry trace state once activated",
  );
});

/** Banner: `makeUUID()` is derived from structure alone. */
Deno.test("mod.ts banner — makeUUID is structure-determined and reuses an existing UUID", () => {
  const a = new Creature(3, 2, { layers: [{ count: 3 }] });
  const clone = Creature.fromJSON(a.exportJSON());

  const uuidA = CreatureUtil.makeUUID(a);
  assertEquals(
    CreatureUtil.makeUUID(clone),
    uuidA,
    "structurally identical creatures share a UUID",
  );
  assertEquals(CreatureUtil.makeUUID(a), uuidA, "an existing UUID is reused");
});

/** Banner: `shuffle()` reorders in place and honours the leading-length bound. */
Deno.test("mod.ts banner — shuffle mutates in place and leaves the tail untouched", () => {
  const array = Int32Array.from([1, 2, 3, 4, 5, 6, 7, 8]);
  CreatureUtil.shuffle(array, 4);

  assertEquals(
    Array.from(array.slice(4)),
    [5, 6, 7, 8],
    "elements past `length` must not move",
  );
  assertEquals(
    Array.from(array.slice(0, 4)).sort((x, y) => x - y),
    [1, 2, 3, 4],
    "the shuffled slice keeps the same members",
  );
});

/** Banner: `NeatOptionsInput` numerics accept strings; `createNeatConfig` parses. */
Deno.test("mod.ts banner — createNeatConfig parses string numerics and freezes the result", () => {
  const config = createNeatConfig({
    populationSize: 12,
    targetError: "0.05",
    trainingSampleRate: "0.5",
  });

  assertEquals(config.targetError, 0.05);
  assertEquals(config.trainingSampleRate, 0.5);
  assert(Object.isFrozen(config), "createNeatConfig returns a frozen config");
});

/** Banner: `createNeatConfig` validates — an out-of-range value fails loud. */
Deno.test("mod.ts banner — createNeatConfig range-checks unvalidated input", () => {
  assertThrows(() => createNeatConfig({ targetError: "-1" }));
});

/** Banner: three named selection strategies; a pinned one is honoured. */
Deno.test("mod.ts banner — Selection exposes exactly three strategies", () => {
  assertEquals(
    Object.values(Selection).map((s) => s.name).sort(),
    ["FITNESS_PROPORTIONATE", "POWER", "TOURNAMENT"],
  );

  const pinned = createNeatConfig({
    populationSize: 10,
    selection: Selection.TOURNAMENT,
  });
  assertEquals(pinned.selection.name, "TOURNAMENT");

  const auto = createNeatConfig({ populationSize: 10 });
  assert(
    ["FITNESS_PROPORTIONATE", "POWER", "TOURNAMENT"].includes(
      auto.selection.name,
    ),
    "an omitted selection is drawn from the three strategies",
  );
});

/** Banner: `Mutation.FFW` omits every recurrent operator and is the default. */
Deno.test("mod.ts banner — Mutation.FFW is the recurrent-free default operator set", () => {
  const recurrent = [
    "ADD_SELF_CONN",
    "SUB_SELF_CONN",
    "ADD_BACK_CONN",
    "SUB_BACK_CONN",
  ];
  const ffw = Mutation.FFW.map((m) => m.name);
  const all = Mutation.ALL.map((m) => m.name);

  for (const name of recurrent) {
    assert(!ffw.includes(name), `FFW must omit the recurrent ${name}`);
    assert(all.includes(name), `ALL must include the recurrent ${name}`);
  }

  const config = createNeatConfig({ populationSize: 10 });
  assertEquals(config.mutation.map((m) => m.name), ffw);
});

/** Banner: `Upgrade.correct` widens the input count and refuses to shrink it. */
Deno.test("mod.ts banner — Upgrade.correct widens inputs and throws when shrinking", () => {
  const creature = new Creature(4, 2);
  const exported = creature.exportJSON();

  const widened = Upgrade.correct(exported, 6);
  assertEquals(widened.input, 6);
  assertEquals(widened.output, 2);

  assertThrows(
    () => Upgrade.correct(exported, 2),
    Error,
    undefined,
    "reducing the input size must fail loud",
  );
});

/** Banner: `Upgrade.CRISPR` renames legacy keys and defaults the mode. */
Deno.test("mod.ts banner — Upgrade.CRISPR migrates legacy DNA to the current shape", () => {
  const legacy = {
    id: "legacy-dna",
    nodes: [{ uuid: "hidden-a", type: "hidden", squash: "IDENTITY", bias: 0 }],
    connections: [{ fromUUID: "input-0", toUUID: "hidden-a", weight: 0.5 }],
  } as unknown as CrisprInterface;

  const cleaned = Upgrade.CRISPR(legacy);
  const raw = cleaned as unknown as Record<string, unknown>;

  assert(!("nodes" in raw), "`nodes` is renamed to `neurons`");
  assert(!("connections" in raw), "`connections` is renamed to `synapses`");
  assertEquals(cleaned.neurons?.length, 1);
  assertEquals(cleaned.synapses.length, 1);
  assertEquals(cleaned.mode, "append", "an absent mode defaults to append");

  const synapse = cleaned.synapses[0];
  assert(
    typeof synapse.fromId === "number" && typeof synapse.toId === "number",
    "UUID endpoints resolve to runtime integer ids",
  );
});

/** Banner: "missing" means an input neuron with no outgoing synapse. */
Deno.test("mod.ts banner — randomConnectMissing only touches unconnected inputs", () => {
  const connected = new Creature(3, 1);
  assertEquals(
    randomConnectMissing(connected),
    connected,
    "a creature with no missing input is returned unchanged",
  );

  const widened = connected.exportJSON();
  widened.input = 6;
  const repaired = randomConnectMissing(Creature.fromJSON(widened));
  const repairedExport = repaired.exportJSON();

  const sourced = new Set<string>();
  for (const synapse of repairedExport.synapses) {
    if (synapse.fromUUID?.startsWith("input-")) sourced.add(synapse.fromUUID);
  }
  for (let i = 0; i < 6; i++) {
    assert(sourced.has(`input-${i}`), `input-${i} must gain a connection`);
  }
});

/** Banner: the export wire format is UUID-keyed; integer ids are runtime-only. */
Deno.test("mod.ts banner — NeuronExport/SynapseExport are UUID-keyed wire shapes", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const exported = creature.exportJSON();

  for (const neuron of exported.neurons) {
    assert(neuron.uuid, "every exported neuron carries a uuid");
    assertEquals(neuron.id, undefined, "runtime ids are omitted from exports");
  }
  for (const synapse of exported.synapses) {
    assert(synapse.fromUUID && synapse.toUUID, "endpoints are uuid strings");
    assertEquals(synapse.fromId, undefined);
    assertEquals(synapse.toId, undefined);
  }

  normaliseCreatureExport(exported);
  for (const synapse of exported.synapses) {
    assert(
      typeof synapse.fromId === "number" && typeof synapse.toId === "number",
      "normaliseCreatureExport populates the runtime integer ids",
    );
  }
});

/** Banner: `upgradeTwo` migrates 1.x and throws on 2.x or higher. */
Deno.test("mod.ts banner — upgradeTwo migrates 1.x and rejects 2.x or higher", () => {
  const base = new Creature(2, 1).exportJSON();

  const legacy: CreatureExport = { ...base, semanticVersion: "1.0.0" };
  assertEquals(upgradeTwo(legacy).semanticVersion, "2.0.0");

  const modern: CreatureExport = { ...base, semanticVersion: "2.0.0" };
  assertThrows(
    () => upgradeTwo(modern),
    Error,
    undefined,
    "upgradeTwo is not safe to call unconditionally",
  );
});
