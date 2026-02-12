/**
 * Tests for LogApproach 'discovery-replay' approach type.
 * Issue #1392: Add 'discovery-replay' to the Approach type union
 * to eliminate the 'as Approach' type cast in Neat.ts.
 */
import { assert } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature, type CreatureExport } from "../../mod.ts";
import { type Approach, logApproach } from "../../src/NEAT/LogApproach.ts";

function createTestCreature(
  score: number,
  approach: string,
): Creature {
  const creatureJSON: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-1", squash: "TANH", bias: 0.1 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
      { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
    ],
    tags: [
      { name: "score", value: score.toString() },
      { name: "approach", value: approach },
    ],
  };
  return Creature.fromJSON(creatureJSON);
}

function createPreviousCreature(score: number): Creature {
  const creatureJSON: CreatureExport = {
    input: 2,
    output: 1,
    neurons: [
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [],
    tags: [
      { name: "score", value: score.toString() },
    ],
  };
  return Creature.fromJSON(creatureJSON);
}

Deno.test("logApproach - handles 'discovery-replay' approach without casting", () => {
  const fittest = createTestCreature(0.9, "discovery-replay");
  addTag(fittest, "discoveryID", "replay-test-123");
  const previous = createPreviousCreature(0.8);

  // 'discovery-replay' should be a valid Approach without needing 'as Approach'
  const approach: Approach = "discovery-replay";
  assert(approach === "discovery-replay");

  let errorThrown = false;
  try {
    logApproach(fittest, previous);
  } catch (e) {
    errorThrown = true;
    console.error("Unexpected error:", e);
  }

  assert(
    !errorThrown,
    "logApproach should handle 'discovery-replay' approach without error",
  );
});

Deno.test("logApproach - all approaches including discovery-replay are valid", () => {
  const allApproaches: Approach[] = [
    "fine",
    "trained",
    "simplified",
    "compact",
    "backtrack",
    "retry",
    "discovery",
    "discovered",
    "discovery-replay",
  ];

  const previous = createPreviousCreature(0.7);

  for (const approach of allApproaches) {
    const fittest = createTestCreature(0.8, approach);

    if (approach === "trained") {
      addTag(fittest, "trainID", "test-train-id");
    }
    if (
      approach === "discovery" || approach === "discovered" ||
      approach === "discovery-replay"
    ) {
      addTag(fittest, "discoveryID", "test-discovery-id");
    }
    if (approach === "compact") {
      addTag(fittest, "old-neurons", "5");
      addTag(fittest, "old-synapses", "10");
    }

    let errorThrown = false;
    try {
      logApproach(fittest, previous);
    } catch (e) {
      errorThrown = true;
      console.error(`Unexpected error for approach '${approach}':`, e);
    }

    assert(
      !errorThrown,
      `logApproach should not throw for '${approach}' approach`,
    );
  }
});
