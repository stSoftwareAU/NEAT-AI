import { assert, assertAlmostEquals, assertEquals } from "@std/assert";
import { addTag, getTag } from "@stsoftware/tags/mod";
import { Creature } from "@creature";
import { calculate } from "@architecture/Score.ts";
import { compactCreature } from "@compact/CompactCreature.ts";
import {
  buildProbeInputs,
  describeDeviation,
  feedsIfNeuron,
  hasRoleTypedIfStructure,
  isExactBehaviourPreserved,
  measureBehaviourDeviation,
} from "@architecture/BehaviourGuard.ts";
import { removeLowImpactNeuron } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryNeuronRemoval.ts";
import type { RemovalCandidate } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverResult.ts";
import { simplify } from "@optimize/Simplify.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import {
  GRAFTED_INPUTS,
  GRAFTED_PATCHES,
  graftedIfForest,
  pointWiseCreature,
} from "../fixtures/GraftedIfForest.ts";
import { initWasmForTests } from "../_initWasm.ts";

/**
 * Issue #3840: `CompactCreature.buildSafeCompact` documents "The returned
 * creature's score is guaranteed ≥ the original's", `Simplify` documents "all
 * without changing what the creature computes", and `DiscoveryNeuronRemoval`
 * advertises removals at `impact: 0.00%`. Nothing enforced any of it, and a
 * fleet published creatures whose scores fell 0.10–0.12 carrying tags from
 * exactly these passes.
 *
 * These tests are the missing proof. The fixture is the shape the field
 * evidence points at: grafted decision-tree patches emitted as `IF` neurons,
 * whose thresholds and leaf values ride as weights on **three bias-1 constants
 * shared across every patch**. Such a constant contributes ~0 to any activation
 * sum — so every magnitude-based heuristic reads it as worthless — while
 * re-assigning the role of, or deleting, one of its edges flips the routing of every node that
 * reads it.
 */

const INPUTS = GRAFTED_INPUTS;
const PATCHES = GRAFTED_PATCHES;
const GROWTH_COST = 0.0001;

/**
 * A deterministic evaluation set. The targets are the fixture's own outputs:
 * these passes claim to be exact, so the creature under test *is* the reference,
 * and any behavioural drift shows up directly as error. That mirrors the field
 * case, where the wrecked creatures were the fittest available.
 */
function evaluationRows(): Float32Array[] {
  let seed = 987654321;
  const next = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const rows: Float32Array[] = [];
  for (let r = 0; r < 96; r++) {
    const row = new Float32Array(INPUTS);
    const scale = r % 3 === 0 ? 1 : r % 3 === 1 ? 0.2 : 4;
    for (let i = 0; i < INPUTS; i++) row[i] = (next() * 2 - 1) * scale;
    rows.push(row);
  }
  return rows;
}

const ROWS = evaluationRows();

function targetsOf(creature: Creature): number[] {
  return ROWS.map((row) => creature.activate(row, false)[0]);
}

function meanSquaredError(creature: Creature, targets: number[]): number {
  let total = 0;
  for (let i = 0; i < ROWS.length; i++) {
    const delta = creature.activate(ROWS[i], false)[0] - targets[i];
    total += delta * delta;
  }
  return total / ROWS.length;
}

function scoreOf(creature: Creature, targets: number[]): number {
  return calculate(creature, meanSquaredError(creature, targets), GROWTH_COST);
}

Deno.test("Issue #3840 fixture is the shape under test", async () => {
  await initWasmForTests();

  const json = graftedIfForest();
  const creature = Creature.fromJSON(json, false);
  creature.validate();

  assert(hasRoleTypedIfStructure(json), "fixture carries role-typed IF edges");
  assert(
    !hasRoleTypedIfStructure(pointWiseCreature()),
    "the point-wise control carries none",
  );

  // Three constants, each shared across every patch.
  for (const uuid of ["constant-0", "constant-1", "constant-2"]) {
    const fanOut = json.synapses.filter((s) => s.fromUUID === uuid).length;
    assert(fanOut >= PATCHES * 2, `${uuid} fan-out ${fanOut} is shared`);
    assert(feedsIfNeuron(json, uuid), `${uuid} feeds an IF neuron`);
  }

  // …and a plain point-wise portion, so the creature is not purely IF.
  const ifNeurons = creature.neurons.filter((n) => n.squash === "IF").length;
  assert(ifNeurons === PATCHES * 3, `${ifNeurons} IF neurons`);
  assert(
    creature.neurons.some((n) =>
      n.type === "hidden" && n.squash === "LOGISTIC"
    ),
    "point-wise portion present",
  );
});

Deno.test("compactCreature: safe compaction never lowers the score", async () => {
  await initWasmForTests();

  const original = Creature.fromJSON(graftedIfForest(), false);
  original.validate();
  const targets = targetsOf(original);
  const before = scoreOf(original, targets);

  const compacted = compactCreature(
    Creature.fromJSON(graftedIfForest(), false),
    false,
  );
  if (compacted === undefined) return; // Nothing folded — the floor is intact.

  const after = scoreOf(compacted, targets);
  assert(
    after >= before,
    `buildSafeCompact must not lower the score: ${before} -> ${after} ` +
      `(delta ${after - before})`,
  );
  assertAlmostEquals(
    meanSquaredError(compacted, targets),
    0,
    1e-9,
    "a behaviour-preserving fold changes no output",
  );
});

Deno.test("simplify: simplification never lowers the score", async () => {
  await initWasmForTests();

  const original = Creature.fromJSON(graftedIfForest(), false);
  original.validate();
  const targets = targetsOf(original);
  const before = scoreOf(original, targets);

  const simplified = simplify(Creature.fromJSON(graftedIfForest(), false));
  if (simplified === undefined) return; // Nothing simplified.

  const after = scoreOf(simplified, targets);
  assert(
    after >= before,
    `simplify must not lower the score: ${before} -> ${after} ` +
      `(delta ${after - before})`,
  );
  assertAlmostEquals(
    meanSquaredError(simplified, targets),
    0,
    1e-9,
    "simplify must not change what the creature computes",
  );
});

Deno.test("DiscoveryNeuronRemoval: an impact 0.00% removal costs no score", async () => {
  await initWasmForTests();

  const original = Creature.fromJSON(graftedIfForest(), false);
  original.validate();
  const targets = targetsOf(original);
  const before = scoreOf(original, targets);

  // Every shared bias-1 constant reads as impact 0.00% to a contribution-based
  // metric: it adds ~0 to any activation sum. Removing one re-routes every IF
  // node that reads it.
  for (const uuid of ["constant-0", "constant-1", "constant-2"]) {
    const candidate: RemovalCandidate = {
      neuronUuid: uuid,
      totalError: 0,
      impact: 0,
      reason: "low-impact",
      meanActivation: 1,
    };
    const removed = removeLowImpactNeuron(
      "issue-3840",
      Creature.fromJSON(graftedIfForest(), false),
      candidate,
    );
    if (removed === undefined) continue; // Refused — the correct outcome.

    const after = scoreOf(removed, targets);
    assert(
      after >= before - 1e-9,
      `removing ${uuid} at impact 0.00% must not cost score: ` +
        `${before} -> ${after} (delta ${after - before})`,
    );
  }
});

Deno.test("the routing probe rejects a candidate whose IF routing moved", async () => {
  await initWasmForTests();

  const original = Creature.fromJSON(graftedIfForest(), false);
  original.validate();

  // Same creature: no deviation at all.
  assert(
    isExactBehaviourPreserved(
      measureBehaviourDeviation(
        original,
        Creature.fromJSON(graftedIfForest(), false),
      ),
    ),
    "an exact copy deviates by nothing",
  );

  // Swap the two branch roles on one leaf. Nothing about the neuron's
  // activation *sum* changes — the same sources, the same weights — only which
  // branch each is read on. That is exactly the class of corruption the folds
  // used to introduce, and it is invisible to every magnitude-based heuristic.
  const wrecked = graftedIfForest();
  const positive = wrecked.synapses.find(
    (s) => s.toUUID === "if-0-lo" && s.type === "positive",
  );
  const negative = wrecked.synapses.find(
    (s) => s.toUUID === "if-0-lo" && s.type === "negative",
  );
  assert(positive && negative, "fixture has both branch roles on if-0-lo");
  positive.type = "negative";
  negative.type = "positive";

  const deviation = measureBehaviourDeviation(
    original,
    Creature.fromJSON(wrecked, false),
  );
  assert(
    !isExactBehaviourPreserved(deviation),
    `a branch whose role was reassigned must be visible to the probe: ${
      describeDeviation(deviation)
    }`,
  );
});

Deno.test("the routing probe never touches a creature without IF structure", async () => {
  await initWasmForTests();

  const json = pointWiseCreature();
  assertEquals(hasRoleTypedIfStructure(json), false);
  assertEquals(feedsIfNeuron(json, "h-0"), false);

  // The gate is the only cost such a creature pays; compaction still runs.
  const creature = Creature.fromJSON(json, false);
  creature.validate();
  const targets = targetsOf(creature);
  const before = scoreOf(creature, targets);

  const compacted = compactCreature(Creature.fromJSON(json, false), false);
  assert(compacted, "the IDENTITY chain still folds");
  const after = scoreOf(compacted, targets);
  assert(
    after >= before,
    `point-wise compaction unchanged: ${before} -> ${after}`,
  );
  assertAlmostEquals(meanSquaredError(compacted, targets), 0, 1e-9);
});

Deno.test("the topology hash separates two IF role assignments", async () => {
  await initWasmForTests();

  const swapped = graftedIfForest();
  const positive = swapped.synapses.find(
    (s) => s.toUUID === "if-0-lo" && s.type === "positive",
  );
  const negative = swapped.synapses.find(
    (s) => s.toUUID === "if-0-lo" && s.type === "negative",
  );
  assert(positive && negative);
  positive.type = "negative";
  negative.type = "positive";

  const a = Creature.fromJSON(graftedIfForest(), false);
  const b = Creature.fromJSON(swapped, false);

  // The compiled WASM template encodes each synapse's role as a `synapse_type`
  // byte and the compilation cache is keyed by this hash. When the two collided,
  // `compileFromTemplate` patched b's weights into a's routing: b then activated
  // as if it were a, so a corrupted candidate scored as though it were intact —
  // and only a fresh process revealed the loss.
  assert(
    CreatureUtil.getTopologyHash(a) !== CreatureUtil.getTopologyHash(b),
    "creatures differing only in IF roles must not share a compiled template",
  );

  // Two structurally identical creatures still share one entry.
  assertEquals(
    CreatureUtil.getTopologyHash(Creature.fromJSON(pointWiseCreature(), false)),
    CreatureUtil.getTopologyHash(Creature.fromJSON(pointWiseCreature(), false)),
    "the hash still dedupes identical topologies",
  );
});

Deno.test("probe inputs are deterministic across calls", () => {
  assertEquals(
    buildProbeInputs(3),
    buildProbeInputs(3),
    "the probe matrix is stable across calls — it must never consume the " +
      "shared RNG nor vary between two runs of the same pass",
  );
});

Deno.test("creature-level tags survive compaction, simplification and removal", async () => {
  await initWasmForTests();

  const tagged = () => {
    const creature = Creature.fromJSON(graftedIfForest(), false);
    addTag(creature, "provenance", "issue-3840");
    addTag(creature, "graft-source", "decision-tree");
    return creature;
  };

  const assertProvenance = (creature: Creature, pass: string) => {
    assertEquals(
      getTag(creature, "provenance"),
      "issue-3840",
      `${pass} must preserve creature-level tags — a wrecked creature that ` +
        `arrives carrying only score and error cannot be traced to a pass`,
    );
    assertEquals(getTag(creature, "graft-source"), "decision-tree", pass);
  };

  const compacted = compactCreature(tagged(), false);
  if (compacted) assertProvenance(compacted, "compactCreature");

  const simplified = simplify(tagged());
  if (simplified) assertProvenance(simplified, "simplify");

  const removed = removeLowImpactNeuron("issue-3840", tagged(), {
    neuronUuid: "plain-0",
    totalError: 0,
    impact: 0,
    reason: "low-impact",
    meanActivation: 0.5,
  });
  if (removed) assertProvenance(removed, "removeLowImpactNeuron");
});
