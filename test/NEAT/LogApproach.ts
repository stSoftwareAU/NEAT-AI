/**
 * Tests for LogApproach functionality.
 * Issue #1082: Unknown approach 'discovered' error.
 */

import { assert, assertThrows } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature, type CreatureExport } from "../../mod.ts";
import { type Approach, logApproach } from "../../src/NEAT/LogApproach.ts";

/**
 * Creates a simple test creature with a score and approach tag.
 */
function createTestCreatureWithApproach(
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

/**
 * Creates a simple previous creature with a score.
 */
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

Deno.test(
  "logApproach: should handle 'discovered' approach without throwing error (issue #1082)",
  () => {
    const fittest = createTestCreatureWithApproach(0.9, "discovered");
    addTag(fittest, "discoveryID", "test-discovery-123");
    const previous = createPreviousCreature(0.8);

    // This should NOT throw an error - the bug is that 'discovered' was not a valid approach
    // After the fix, this should log the discovery message without throwing
    let errorThrown = false;
    try {
      logApproach(fittest, previous);
    } catch (e) {
      errorThrown = true;
      console.error("Unexpected error:", e);
    }

    assert(
      !errorThrown,
      "logApproach should not throw an error for 'discovered' approach",
    );
  },
);

Deno.test(
  "logApproach: should handle 'discovery' approach without throwing error",
  () => {
    const fittest = createTestCreatureWithApproach(0.9, "discovery");
    addTag(fittest, "discoveryID", "test-discovery-456");
    const previous = createPreviousCreature(0.8);

    let errorThrown = false;
    try {
      logApproach(fittest, previous);
    } catch (e) {
      errorThrown = true;
      console.error("Unexpected error:", e);
    }

    assert(
      !errorThrown,
      "logApproach should not throw an error for 'discovery' approach",
    );
  },
);

Deno.test(
  "logApproach: should handle all valid approach types",
  () => {
    const validApproaches: Approach[] = [
      "fine",
      "trained",
      "simplified",
      "compact",
      "backtrack",
      "retry",
      "discovery",
      "discovered",
    ];

    const previous = createPreviousCreature(0.7);

    for (const approach of validApproaches) {
      const fittest = createTestCreatureWithApproach(0.8, approach);

      // Add additional tags that certain approaches expect
      if (approach === "trained") {
        addTag(fittest, "trainID", "test-train-id");
      }
      if (approach === "discovery" || approach === "discovered") {
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
        `logApproach should not throw an error for '${approach}' approach`,
      );
    }
  },
);

Deno.test(
  "logApproach: should throw error for truly unknown approaches",
  () => {
    const fittest = createTestCreatureWithApproach(0.9, "invalid-approach");
    const previous = createPreviousCreature(0.8);

    assertThrows(
      () => {
        logApproach(fittest, previous);
      },
      Error,
      "Unknown approach 'invalid-approach'",
    );
  },
);
