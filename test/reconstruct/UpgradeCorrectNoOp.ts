import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { Creature } from "@creature";
import { getLogger, setLogger } from "@utils/Logger.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { Upgrade } from "@reconstruct/Upgrade.ts";
import {
  describeDeviation,
  isExactBehaviourPreserved,
  measureBehaviourDeviation,
} from "@architecture/BehaviourGuard.ts";
import {
  GRAFTED_INPUTS,
  graftedIfForest,
  pointWiseCreature,
} from "../fixtures/GraftedIfForest.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #3845: `Upgrade.correct()` is the repair pass every creature is put
 * through on load. It ran `Creature.fix()` unconditionally — a legacy v1.x/v2.x
 * migration applied to modern, valid genomes.
 *
 * On a grafted `IF` forest that cost 90.7 % of the creature's score. In such a
 * forest a leaf value rides as the **weight on a shared bias-1 constant** feeding
 * a branch role. A leaf whose value is exactly zero is an ordinary decision-tree
 * leaf, but `fix()` reads a zero-weight synapse as dead wiring, drops it, and the
 * branch is then re-sourced from an arbitrary neuron. The constant leaf becomes
 * an input-dependent term and the tree stops being a tree.
 *
 * The invariant these tests pin down, stated by the repo owner:
 *
 * > "If you're repairing that means the creature is invalid in some way. We
 * > should not need to repair any creature now."
 *
 * and, on what should happen when it does fire:
 *
 * > "Yes, only 'correct' if there's a validation issue which we should be
 * > shouting about…"
 *
 * So: a creature that passes `validate()` is returned untouched; a creature that
 * fails it is still repaired, and the repair is announced loudly enough to trace
 * the defect back to whatever produced the creature.
 */

/** `fromUUID -> toUUID [role]` — the identity of one wire. */
function synapseKey(
  s: { fromUUID?: string; toUUID?: string; type?: string },
): string {
  return `${s.fromUUID} -> ${s.toUUID} [${s.type ?? "none"}]`;
}

interface StructuralDiff {
  removed: string[];
  added: string[];
  weightChanges: string[];
  neuronsRemoved: string[];
  neuronsAdded: string[];
  neuronsAltered: string[];
}

function diffExports(
  before: CreatureExport,
  after: CreatureExport,
): StructuralDiff {
  const beforeSynapses = new Map(
    before.synapses.map((s) => [synapseKey(s), s.weight]),
  );
  const afterSynapses = new Map(
    after.synapses.map((s) => [synapseKey(s), s.weight]),
  );
  const describeNeuron = (n: CreatureExport["neurons"][number]) =>
    `${n.type}:${n.squash ?? "none"}:${n.bias ?? 0}`;
  const beforeNeurons = new Map(
    before.neurons.map((n) => [n.uuid!, describeNeuron(n)]),
  );
  const afterNeurons = new Map(
    after.neurons.map((n) => [n.uuid!, describeNeuron(n)]),
  );

  return {
    removed: [...beforeSynapses.keys()].filter((k) => !afterSynapses.has(k)),
    added: [...afterSynapses.keys()].filter((k) => !beforeSynapses.has(k)),
    weightChanges: [...beforeSynapses.entries()]
      .filter(([k, w]) => afterSynapses.has(k) && afterSynapses.get(k) !== w)
      .map(([k, w]) => `${k}: ${w} -> ${afterSynapses.get(k)}`),
    neuronsRemoved: [...beforeNeurons.keys()].filter((u) =>
      !afterNeurons.has(u)
    ),
    neuronsAdded: [...afterNeurons.keys()].filter((u) => !beforeNeurons.has(u)),
    neuronsAltered: [...beforeNeurons.entries()]
      .filter(([u, d]) => afterNeurons.has(u) && afterNeurons.get(u) !== d)
      .map(([u, d]) => `${u}: ${d} -> ${afterNeurons.get(u)}`),
  };
}

function describeDiff(diff: StructuralDiff): string {
  return [
    `removed ${diff.removed.length} ${
      JSON.stringify(diff.removed.slice(0, 4))
    }`,
    `added ${diff.added.length} ${JSON.stringify(diff.added.slice(0, 4))}`,
    `weightChanges ${diff.weightChanges.length} ${
      JSON.stringify(diff.weightChanges.slice(0, 4))
    }`,
    `neurons -${diff.neuronsRemoved.length} +${diff.neuronsAdded.length} ~${diff.neuronsAltered.length}`,
  ].join("; ");
}

function assertUntouched(name: string, json: CreatureExport): CreatureExport {
  const before = Creature.fromJSON(structuredClone(json), false).exportJSON();
  const after = Upgrade.correct(structuredClone(before), before.input)
    .exportJSON();
  const diff = diffExports(before, after);

  assertEquals(
    after.neurons.length,
    before.neurons.length,
    `${name}: neuron count changed`,
  );
  assertEquals(
    after.synapses.length,
    before.synapses.length,
    `${name}: synapse count changed`,
  );
  assertEquals(
    diff.removed.length,
    0,
    `${name}: Upgrade.correct() removed synapses — ${describeDiff(diff)}`,
  );
  assertEquals(
    diff.added.length,
    0,
    `${name}: Upgrade.correct() added synapses — ${describeDiff(diff)}`,
  );
  assertEquals(
    diff.weightChanges.length,
    0,
    `${name}: Upgrade.correct() changed weights — ${describeDiff(diff)}`,
  );
  assertEquals(
    diff.neuronsAltered.length,
    0,
    `${name}: Upgrade.correct() altered neurons — ${describeDiff(diff)}`,
  );
  return after;
}

/**
 * The production shape: a grafted `IF` forest in which one leaf value is exactly
 * zero. Nothing about that is invalid — a decision tree may perfectly well
 * predict 0 on a branch — and `validate()` accepts it.
 */
function graftedIfForestWithZeroLeaf(): CreatureExport {
  const json = graftedIfForest();
  const leaf = json.synapses.find(
    (s) => s.toUUID === "if-2-lo" && s.type === "positive",
  );
  assert(leaf, "fixture carries a positive branch on if-2-lo");
  leaf.weight = 0;
  return json;
}

/** A creature that is genuinely broken: a constant with no outward edge. */
function strandedConstant(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    input: 2,
    output: 1,
    neurons: [
      { type: "constant", uuid: "constant-stranded", bias: 1 },
      { type: "hidden", uuid: "h-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-0", weight: 0.5 },
      { fromUUID: "h-0", toUUID: "output-0", weight: 1 },
    ],
  };
}

/** A creature that is genuinely broken: a hidden neuron with no inward edge. */
function hiddenWithoutInbound(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "h-orphan", squash: "LOGISTIC", bias: 0.3 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
      { fromUUID: "h-orphan", toUUID: "output-0", weight: 1 },
    ],
  };
}

/** A creature that is genuinely broken: an `IF` missing its negative branch. */
function ifMissingNegativeBranch(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    input: 2,
    output: 1,
    neurons: [
      { type: "constant", uuid: "constant-0", bias: 1 },
      { type: "hidden", uuid: "if-0", squash: "IF", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "if-0", weight: 1, type: "condition" },
      {
        fromUUID: "constant-0",
        toUUID: "if-0",
        weight: -0.5,
        type: "condition",
      },
      { fromUUID: "constant-0", toUUID: "if-0", weight: 0.4, type: "positive" },
      { fromUUID: "if-0", toUUID: "output-0", weight: 1 },
    ],
  };
}

/**
 * A genuine pre-4.x genome that is also structurally broken: a stranded constant
 * with no outward edge and a hidden neuron with no inward edge. Old files really
 * do arrive like this, and the migration must still put them right.
 */
function legacyBrokenCreature(version: string): CreatureExport {
  return {
    semanticVersion: version,
    input: 2,
    output: 1,
    neurons: [
      { type: "constant", uuid: "constant-stranded", bias: 1 },
      { type: "hidden", uuid: "h-orphan", squash: "LOGISTIC", bias: 0.3 },
      { type: "hidden", uuid: "h-0", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "h-0", weight: 0.5 },
      { fromUUID: "h-0", toUUID: "output-0", weight: 1 },
      { fromUUID: "h-orphan", toUUID: "output-0", weight: 0.25 },
    ],
  };
}

/** Capture what the repair path shouts, restoring the logger afterwards. */
function captureLogs(): { lines: string[]; dispose: () => void } {
  const lines: string[] = [];
  const previous = getLogger();
  const sink = (...args: unknown[]) => {
    lines.push(args.map((a) => String(a)).join(" "));
  };
  setLogger({ debug: sink, info: sink, warn: sink, error: sink });
  return {
    lines,
    dispose() {
      setLogger(previous);
    },
  };
}

Deno.test("Issue #3845: the zero-leaf grafted IF forest is valid to begin with", () => {
  const json = graftedIfForestWithZeroLeaf();
  const creature = Creature.fromJSON(json, false);
  creature.validate();

  const zeroLeaves = json.synapses.filter((s) =>
    s.weight === 0 && s.type !== undefined
  );
  assertEquals(
    zeroLeaves.length,
    1,
    "exactly one branch carries a zero leaf value",
  );
});

Deno.test("Issue #3845: Upgrade.correct() rewires nothing on a valid grafted IF creature", () => {
  assertUntouched("grafted IF forest", graftedIfForest());
  assertUntouched(
    "grafted IF forest, zero leaf",
    graftedIfForestWithZeroLeaf(),
  );
});

Deno.test("Issue #3845: Upgrade.correct() does not change what a valid creature computes", async () => {
  await initWasmForTests();

  for (
    const [name, json] of [
      ["grafted IF forest", graftedIfForest()],
      ["grafted IF forest, zero leaf", graftedIfForestWithZeroLeaf()],
      ["point-wise", pointWiseCreature()],
    ] as const
  ) {
    const before = Creature.fromJSON(structuredClone(json), false);
    before.validate();
    const after = Upgrade.correct(
      Creature.fromJSON(structuredClone(json), false).exportJSON(),
      json.input,
    );

    const deviation = measureBehaviourDeviation(before, after);
    assert(
      isExactBehaviourPreserved(deviation),
      `${name}: Upgrade.correct() moved the outputs of a valid creature — ${
        describeDeviation(deviation)
      }`,
    );
  }
});

Deno.test("Issue #3845: any creature that passes validate() is returned structurally identical", () => {
  const dense = new Creature(GRAFTED_INPUTS, 2).exportJSON();

  for (
    const [name, json] of [
      ["grafted IF forest", graftedIfForest()],
      ["grafted IF forest, zero leaf", graftedIfForestWithZeroLeaf()],
      ["point-wise", pointWiseCreature()],
      ["dense", dense],
    ] as const
  ) {
    // The premise of the invariant: these creatures need no repair.
    creatureValidate(Creature.fromJSON(structuredClone(json), false));
    assertUntouched(name, json);
  }
});

Deno.test("Issue #3845: widening the input count still works and still repairs nothing", () => {
  const json = graftedIfForest();
  const before = Creature.fromJSON(json, false).exportJSON();
  const widened = Upgrade.correct(structuredClone(before), GRAFTED_INPUTS + 4);

  assertEquals(widened.input, GRAFTED_INPUTS + 4, "the input count widened");
  const diff = diffExports(before, widened.exportJSON());
  assertEquals(
    diff.removed.length + diff.added.length + diff.weightChanges.length,
    0,
    `widening must not rewire — ${describeDiff(diff)}`,
  );
});

Deno.test("Issue #3845: a genuinely invalid creature is still repaired", () => {
  // Stranded constant — no outward edge. The legacy pass removes it.
  {
    const json = strandedConstant();
    const repaired = Upgrade.correct(structuredClone(json), json.input)
      .exportJSON();
    assert(
      !repaired.neurons.some((n) => n.uuid === "constant-stranded"),
      "the stranded constant must still be removed",
    );
  }

  // Hidden neuron with no inward edge — the legacy pass wires one in.
  {
    const json = hiddenWithoutInbound();
    const repaired = Upgrade.correct(structuredClone(json), json.input)
      .exportJSON();
    const orphan = repaired.neurons.find((n) => n.uuid === "h-orphan");
    if (orphan && orphan.type === "hidden") {
      assert(
        repaired.synapses.some((s) => s.toUUID === "h-orphan"),
        "a hidden neuron left with no inward edge must still be repaired",
      );
    }
    creatureValidate(Creature.fromJSON(repaired, false));
  }

  // IF neuron missing its negative branch — the legacy pass downgrades it.
  {
    const json = ifMissingNegativeBranch();
    const repaired = Upgrade.correct(structuredClone(json), json.input)
      .exportJSON();
    creatureValidate(Creature.fromJSON(repaired, false));
    const repairedIf = repaired.neurons.find((n) => n.uuid === "if-0");
    assert(repairedIf, "the IF neuron survives");
    assert(
      repairedIf.squash !== "IF" ||
        repaired.synapses.filter((s) => s.toUUID === "if-0").length >= 3,
      "a structurally invalid IF must still be repaired",
    );
  }
});

Deno.test("Issue #3845: a genuine v1.x/v2.x/v3.x creature is still migrated and repaired", () => {
  for (const version of ["1.0.0", "2.0.0", "3.0.0"]) {
    const json = legacyBrokenCreature(version);
    const capture = captureLogs();
    let repaired: CreatureExport;
    try {
      repaired = Upgrade.correct(structuredClone(json), json.input)
        .exportJSON();
    } finally {
      capture.dispose();
    }

    assert(
      !repaired.neurons.some((n) => n.uuid === "constant-stranded"),
      `${version}: the stranded constant must still be removed`,
    );
    assert(
      !repaired.neurons.some((n) =>
        n.uuid === "h-orphan" && n.type === "hidden"
      ) || repaired.synapses.some((s) => s.toUUID === "h-orphan"),
      `${version}: the inbound-less hidden must still be repaired`,
    );
    creatureValidate(Creature.fromJSON(repaired, false));
  }
});

Deno.test("Issue #3845: repairing an invalid creature shouts, and a valid one says nothing", () => {
  // An invalid creature carrying the producer tags a real genome arrives with.
  const json = strandedConstant();
  json.tags = [
    { name: "forests", value: "🌳 Forests · 23 accepts / 23 iters" },
    { name: "LEARN_HOST", value: "cluster-node" },
    { name: "score", value: "0.3689953523995453" },
  ];

  const capture = captureLogs();
  try {
    Upgrade.correct(structuredClone(json), json.input);
  } finally {
    capture.dispose();
  }
  const shout = capture.lines.join("\n");

  assertStringIncludes(shout, "Upgrade.correct", "the pass names itself");
  assertStringIncludes(
    shout,
    "NO_OUTWARD_CONNECTIONS",
    "the failed validation rule must be on the record",
  );
  assertStringIncludes(
    shout,
    "constant-stranded",
    "the offending neuron must be named",
  );
  assertStringIncludes(
    shout,
    "forests",
    "the producer tag must be on the record",
  );
  assertStringIncludes(
    shout,
    "LEARN_HOST",
    "the producing host must be on the record",
  );

  // A valid creature is not a repair event and must not produce one.
  const quiet = captureLogs();
  try {
    Upgrade.correct(
      Creature.fromJSON(graftedIfForestWithZeroLeaf(), false).exportJSON(),
      GRAFTED_INPUTS,
    );
  } finally {
    quiet.dispose();
  }
  assertEquals(
    quiet.lines.filter((l) => l.includes("Upgrade.correct")),
    [],
    "a valid creature must not be announced as a repair",
  );
});

Deno.test("Issue #3845: the production forests champion loads untouched", async () => {
  // A real fleet genome checked into `test/data`: 2,538 neurons, 24,100
  // synapses, 185 grafted `IF` neurons whose branch roles read shared bias-1
  // constants, and four branches whose leaf value is exactly zero. It validates,
  // and before the fix those four branches were re-sourced onto other neurons —
  // the same `neuron-132866057` the issue names.
  const json: CreatureExport = JSON.parse(
    await Deno.readTextFile("./test/data/grq-23-forests-constants.json"),
  );
  const creature = Creature.fromJSON(json, false);
  creatureValidate(creature);

  const before = creature.exportJSON();
  const zeroWeightBranches = before.synapses.filter((s) =>
    s.weight === 0 && s.type !== undefined
  );
  assertEquals(
    zeroWeightBranches.length,
    4,
    "the champion carries four zero-valued branch leaves",
  );

  const after = Upgrade.correct(structuredClone(before), before.input)
    .exportJSON();
  const diff = diffExports(before, after);
  assertEquals(
    diff.removed.length,
    0,
    `the champion must not be rewired — ${describeDiff(diff)}`,
  );
  assertEquals(
    diff.added.length,
    0,
    `the champion must not be rewired — ${describeDiff(diff)}`,
  );
  assertEquals(
    diff.weightChanges.length,
    0,
    `the champion must not have its weights changed — ${describeDiff(diff)}`,
  );

  // The other documented ingest path carried the same unconditional repair.
  const persisted = Creature.fromPersistedJSON(structuredClone(before))
    .exportJSON();
  const persistedDiff = diffExports(before, persisted);
  assertEquals(
    persistedDiff.removed.length + persistedDiff.added.length +
      persistedDiff.weightChanges.length,
    0,
    `fromPersistedJSON must not rewire either — ${describeDiff(persistedDiff)}`,
  );
});

Deno.test("Issue #3845: Creature.fromPersistedJSON obeys the same invariant", () => {
  // Valid in, identical out.
  for (
    const [name, json] of [
      ["grafted IF forest, zero leaf", graftedIfForestWithZeroLeaf()],
      ["point-wise", pointWiseCreature()],
    ] as const
  ) {
    const before = Creature.fromJSON(structuredClone(json), false).exportJSON();
    const after = Creature.fromPersistedJSON(structuredClone(before))
      .exportJSON();
    const diff = diffExports(before, after);
    assertEquals(
      diff.removed.length + diff.added.length + diff.weightChanges.length,
      0,
      `${name}: fromPersistedJSON must return a valid creature untouched — ${
        describeDiff(diff)
      }`,
    );
  }

  // Invalid in, repaired out — and announced.
  const capture = captureLogs();
  try {
    const repaired = Creature.fromPersistedJSON(strandedConstant())
      .exportJSON();
    assert(
      !repaired.neurons.some((n) => n.uuid === "constant-stranded"),
      "fromPersistedJSON must still repair a genuinely invalid creature",
    );
  } finally {
    capture.dispose();
  }
  assertStringIncludes(
    capture.lines.join("\n"),
    "Creature.fromPersistedJSON",
    "the repairing ingest path must name itself",
  );
});
