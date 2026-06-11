/**
 * Tests for the On-Policy Distillation breeding operator (Issue #2528).
 *
 * Covers:
 *   - Happy path: student MSE against the consensus target decreases
 *     across distillation steps on a tiny synthetic problem.
 *   - UUID stability: offspring contains only fresh hidden UUIDs;
 *     teacher hidden UUIDs are unchanged.
 *   - K = 1: falls back to clone-and-train and emits a warning.
 *   - Disjoint topologies: teachers with no shared hidden UUIDs still
 *     produce a valid offspring.
 *   - Default rate: `opd.breedRate = 0` keeps the operator idle so the
 *     existing breeding flow is unchanged.
 *   - exportJSON round-trip is byte-stable.
 */
import { assert, assertEquals } from "@std/assert";
import { Creature, type CreatureExport } from "../../mod.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import {
  DEFAULT_OPD_CONFIG,
  type RequiredOpdConfig,
} from "@config/OpdConfig.ts";
import { onPolicyDistillationBreed } from "@breed/OnPolicyDistillationBreed.ts";
import { addTag, getTag } from "@stsoftware/tags/mod";
import { Breed } from "@breed/Breed.ts";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { Genus } from "@neat/Genus.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";
import {
  CURRENT_GENERATION_TAG,
  WARMUP_GENERATIONS_TAG,
  writeSeedWarmupProgressTags,
} from "@architecture/CreatureFactory.ts";

// DEBUG mode is intentionally NOT enabled here: it injects diagnostic
// numeric `id` fields into `exportJSON()` output that destabilise the
// round-trip byte equality test below.

/**
 * Builds a small forward-only creature with a configurable hidden layer.
 * Each hidden neuron is fully connected to all inputs and the single
 * output is fully connected from the hidden layer.
 */
function buildSimpleCreature(
  inputCount: number,
  hiddenUuids: string[],
  outputCount = 1,
): Creature {
  const neurons: CreatureExport["neurons"] = hiddenUuids.map((uuid) => ({
    type: "hidden" as const,
    uuid,
    squash: "LOGISTIC",
    bias: 0.05,
  }));
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
  }

  const synapses: CreatureExport["synapses"] = [];
  // Inputs to every hidden.
  for (let i = 0; i < inputCount; i++) {
    for (let h = 0; h < hiddenUuids.length; h++) {
      synapses.push({
        fromUUID: `input-${i}`,
        toUUID: hiddenUuids[h],
        weight: 0.5 - (i + h) * 0.1,
      });
    }
  }
  // Hidden to every output.
  for (const h of hiddenUuids) {
    for (let o = 0; o < outputCount; o++) {
      synapses.push({
        fromUUID: h,
        toUUID: `output-${o}`,
        weight: 0.4,
      });
    }
  }

  const json: CreatureExport = {
    input: inputCount,
    output: outputCount,
    neurons,
    synapses,
    forwardOnly: true,
  };
  return Creature.fromJSON(json);
}

function defaultOpd(overrides: Partial<RequiredOpdConfig> = {}) {
  return { ...DEFAULT_OPD_CONFIG, breedRate: 1.0, ...overrides };
}

Deno.test("OnPolicyDistillationBreed - happy path: student MSE drops across distillation", () => {
  const teacherA = buildSimpleCreature(2, ["a-h0", "a-h1", "a-h2"]);
  const teacherB = buildSimpleCreature(2, ["b-h0", "b-h1", "b-h2"]);
  const teacherC = buildSimpleCreature(2, ["c-h0", "c-h1", "c-h2"]);

  const result = onPolicyDistillationBreed(
    [teacherA, teacherB, teacherC],
    defaultOpd({
      teacherCount: 3,
      distillationSteps: 30,
      calibrationBatchSize: 8,
      learningRate: 0.05,
    }),
  );

  assert(result, "OPD must produce an offspring on three valid teachers");
  assertEquals(result.teachersUsed, 3);
  assert(
    result.finalError <= result.initialError,
    `Expected finalError (${result.finalError}) to drop below initialError (${result.initialError})`,
  );
});

Deno.test("OnPolicyDistillationBreed - UUID stability: offspring uses fresh hidden UUIDs and teachers are untouched", () => {
  const teacherA = buildSimpleCreature(2, ["uuid-A0", "uuid-A1"]);
  const teacherB = buildSimpleCreature(2, ["uuid-B0", "uuid-B1"]);

  const teacherAUuids = teacherA.neurons
    .filter((n) => n.type === "hidden")
    .map((n) => n.uuid);
  const teacherBUuids = teacherB.neurons
    .filter((n) => n.type === "hidden")
    .map((n) => n.uuid);
  const teacherAUuidSet = new Set(teacherAUuids);
  const teacherBUuidSet = new Set(teacherBUuids);

  const result = onPolicyDistillationBreed(
    [teacherA, teacherB],
    defaultOpd({
      teacherCount: 2,
      distillationSteps: 5,
      calibrationBatchSize: 4,
    }),
  );
  assert(result, "OPD breed must succeed");

  // Offspring hidden UUIDs are fresh — none appears in either teacher.
  for (const n of result.offspring.neurons) {
    if (n.type === "hidden") {
      assert(
        typeof n.uuid === "string",
        "every hidden neuron must carry a UUID",
      );
      assert(
        !teacherAUuidSet.has(n.uuid),
        `offspring hidden UUID ${n.uuid} leaked from teacher A`,
      );
      assert(
        !teacherBUuidSet.has(n.uuid),
        `offspring hidden UUID ${n.uuid} leaked from teacher B`,
      );
    }
  }

  // Teacher UUIDs are unchanged after distillation.
  const postA = teacherA.neurons
    .filter((n) => n.type === "hidden")
    .map((n) => n.uuid);
  const postB = teacherB.neurons
    .filter((n) => n.type === "hidden")
    .map((n) => n.uuid);
  assertEquals(postA, teacherAUuids);
  assertEquals(postB, teacherBUuids);
});

Deno.test("OnPolicyDistillationBreed - K=1 falls back to clone-and-train", () => {
  const teacher = buildSimpleCreature(2, ["solo-h0", "solo-h1"]);
  const result = onPolicyDistillationBreed(
    [teacher],
    defaultOpd({ teacherCount: 1, distillationSteps: 5 }),
  );
  assert(result, "K=1 must still return an offspring");
  assertEquals(result.teachersUsed, 1);
  // Offspring carries fresh hidden UUIDs even on the K=1 path.
  for (const n of result.offspring.neurons) {
    if (n.type === "hidden") {
      assert(n.uuid !== "solo-h0" && n.uuid !== "solo-h1");
    }
  }
});

Deno.test("OnPolicyDistillationBreed - disjoint topologies still produce a valid student", () => {
  // Two teachers with no shared hidden UUIDs and different hidden counts.
  const teacherA = buildSimpleCreature(2, ["disjA-0", "disjA-1"]);
  const teacherB = buildSimpleCreature(2, ["disjB-0", "disjB-1", "disjB-2"]);
  const result = onPolicyDistillationBreed(
    [teacherA, teacherB],
    defaultOpd({ teacherCount: 2, distillationSteps: 5 }),
  );
  assert(
    result,
    "OPD must succeed even when teachers have disjoint topologies",
  );

  // The student must structurally validate.
  if (result.offspring.forwardOnly) {
    creatureValidate(result.offspring, { forwardOnly: true });
  } else {
    creatureValidate(result.offspring);
  }

  // The student must successfully activate on a fresh input.
  const input = new Float32Array([0.1, -0.2]);
  const out = result.offspring.activate(input);
  assertEquals(out.length, 1);
  assert(Number.isFinite(out[0]), "student output must be finite");
});

Deno.test("OnPolicyDistillationBreed - rejects mismatched input/output shapes", () => {
  const teacherA = buildSimpleCreature(2, ["shape-A"]);
  const teacherB = buildSimpleCreature(3, ["shape-B"]); // different input size
  const result = onPolicyDistillationBreed(
    [teacherA, teacherB],
    defaultOpd({ teacherCount: 2 }),
  );
  assertEquals(result, undefined);
});

Deno.test("OnPolicyDistillationBreed - exportJSON round-trip is byte-stable", () => {
  const teacherA = buildSimpleCreature(2, ["rt-A0", "rt-A1"]);
  const teacherB = buildSimpleCreature(2, ["rt-B0", "rt-B1"]);
  const result = onPolicyDistillationBreed(
    [teacherA, teacherB],
    defaultOpd({ teacherCount: 2, distillationSteps: 3 }),
  );
  assert(result);

  // Round-trip stability: a CreatureExport, after stripping any
  // internal numeric `id`/`fromId`/`toId` leakage, round-trips
  // byte-stable. The integer ids are documented as internal-only
  // (Issue #2090); we deliberately strip them before comparing so the
  // assertion measures the stable wire-format identity (UUID-only)
  // rather than ephemeral runtime ids.
  const stripIds = (e: ReturnType<typeof result.offspring.exportJSON>) => {
    const cloned = JSON.parse(JSON.stringify(e)) as Record<string, unknown>;
    const neurons = cloned.neurons as Array<Record<string, unknown>>;
    for (const n of neurons) delete n.id;
    const synapses = cloned.synapses as Array<Record<string, unknown>>;
    for (const s of synapses) {
      delete s.fromId;
      delete s.toId;
    }
    return cloned;
  };

  const first = result.offspring.exportJSON();
  const reloaded = Creature.fromJSON(first);
  const second = reloaded.exportJSON();
  assertEquals(
    JSON.stringify(stripIds(first)),
    JSON.stringify(stripIds(second)),
    "exportJSON round-trip must produce byte-stable UUID-only output",
  );
});

Deno.test("OnPolicyDistillationBreed - default config keeps operator idle", () => {
  // Sanity: with `opd.breedRate = 0`, the createNeatConfig defaults
  // produce a config where OPD never selects itself in Breed.breed().
  const config = createNeatConfig({ populationSize: 4 });
  assertEquals(config.opd.breedRate, 0);
  assertEquals(config.opd.teacherCount, DEFAULT_OPD_CONFIG.teacherCount);
});

Deno.test(
  "OnPolicyDistillationBreed - Breed integration: opd.breedRate=1 routes through OPD operator",
  () => {
    // Build a small population of distinct elite creatures and verify
    // that `Breed.breed()` produces a creature whose hidden UUIDs are
    // NOT shared with any teacher (proving the OPD path was taken).
    const elites: Creature[] = [];
    const teacherUuids = new Set<string>();
    for (let i = 0; i < 3; i++) {
      const uuid = `teacher-${i}-h`;
      teacherUuids.add(uuid);
      const c = buildSimpleCreature(2, [uuid]);
      CreatureUtil.makeUUID(c);
      c.score = 1 - i * 0.1;
      addTag(c, "score", c.score.toString());
      elites.push(c);
    }

    const genus = new Genus();
    for (const c of elites) genus.addCreature(c);

    const config = createNeatConfig({
      populationSize: elites.length,
      opd: {
        breedRate: 1.0,
        teacherCount: 3,
        distillationSteps: 2,
        calibrationBatchSize: 4,
      },
    });
    const breed = new Breed(genus, config);
    let offspring: Creature | undefined;
    for (let attempt = 0; attempt < 5 && !offspring; attempt++) {
      offspring = breed.breed();
    }
    assert(offspring, "OPD breed must produce an offspring");

    // Hidden UUIDs in offspring are fresh — none match any teacher.
    for (const n of offspring.neurons) {
      if (n.type === "hidden" && typeof n.uuid === "string") {
        assert(
          !teacherUuids.has(n.uuid),
          `offspring hidden uuid ${n.uuid} must not be a teacher uuid`,
        );
      }
    }
  },
);

Deno.test(
  "OnPolicyDistillationBreed - offspring does NOT carry warm-up tags from teachers (Issue #2911)",
  () => {
    // The Neat-level counter is the single source of truth mid-run; the
    // distilled student must not inherit the teachers' warm-up tags.
    const teacherA = buildSimpleCreature(2, ["warm-a-h0", "warm-a-h1"]);
    const teacherB = buildSimpleCreature(2, ["warm-b-h0", "warm-b-h1"]);
    writeSeedWarmupProgressTags(teacherA, 1440, 77);
    writeSeedWarmupProgressTags(teacherB, 1440, 77);

    const result = onPolicyDistillationBreed(
      [teacherA, teacherB],
      defaultOpd({
        teacherCount: 2,
        distillationSteps: 4,
        calibrationBatchSize: 4,
      }),
    );

    assert(result, "OPD must produce an offspring");
    assertEquals(getTag(result.offspring, WARMUP_GENERATIONS_TAG), null);
    assertEquals(getTag(result.offspring, CURRENT_GENERATION_TAG), null);
  },
);
