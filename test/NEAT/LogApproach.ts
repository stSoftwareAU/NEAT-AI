/**
 * Tests for LogApproach functionality.
 * Issue #1082: Unknown approach 'discovered' error.
 */

import { assert, assertEquals } from "@std/assert";
import { addTag } from "@stsoftware/tags/mod";
import { Creature, type CreatureExport } from "../../mod.ts";
import { type Approach, logApproach } from "@neat/LogApproach.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

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

/** The lines each log level received while a callback ran. */
interface CapturedLogs {
  debug: string[];
  info: string[];
  warn: string[];
  error: string[];
}

/**
 * Runs `fn` with a capturing logger installed and returns what each level
 * received. The previous logger is restored even when `fn` throws.
 */
function captureLogs(fn: () => void): CapturedLogs {
  const captured: CapturedLogs = { debug: [], info: [], warn: [], error: [] };
  const capture: Logger = {
    debug: (...args) => {
      captured.debug.push(args.map(String).join(" "));
    },
    info: (...args) => {
      captured.info.push(args.map(String).join(" "));
    },
    warn: (...args) => {
      captured.warn.push(args.map(String).join(" "));
    },
    error: (...args) => {
      captured.error.push(args.map(String).join(" "));
    },
  };
  const original = getLogger();
  setLogger(capture);
  try {
    fn();
  } finally {
    setLogger(original);
  }
  return captured;
}

// Record<Approach, true> makes `deno check` fail if a member of the Approach
// union is missing from this list.
const EVERY_APPROACH: Record<Approach, true> = {
  "fine": true,
  "trained": true,
  "predictive-coding": true,
  "predictive-coding-compact": true,
  "simplified": true,
  "compact": true,
  "backtrack": true,
  "retry": true,
  "discovery": true,
  "discovered": true,
  "discovery-replay": true,
};

Deno.test(
  "logApproach: warns and does not throw for an unknown approach tag (issue #4188)",
  () => {
    const fittest = createTestCreatureWithApproach(0.9, "invalid-approach");
    const previous = createPreviousCreature(0.8);

    // A throw from logApproach would fail this test here.
    const logs = captureLogs(() => logApproach(fittest, previous));

    assertEquals(logs.warn.length, 1, "expected exactly one warn line");
    assert(
      logs.warn[0].includes("Unknown approach 'invalid-approach'"),
      `warn line should name the unknown approach, got: ${logs.warn[0]}`,
    );
    assertEquals(logs.info.length, 0, "expected no info lines");
  },
);

Deno.test(
  "logApproach: predictive-coding-compact logs the compacted result without throwing (issue #4188)",
  () => {
    const fittest = createTestCreatureWithApproach(
      0.9,
      "predictive-coding-compact",
    );
    addTag(fittest, "old-neurons", "7");
    addTag(fittest, "old-synapses", "12");
    addTag(fittest, "trainID", "pc-train-1");
    const previous = createPreviousCreature(0.8);

    // A throw from logApproach would fail this test here.
    const logs = captureLogs(() => logApproach(fittest, previous));

    assertEquals(logs.info.length, 1, "expected exactly one info line");
    assertEquals(logs.warn.length, 0, "expected no warn lines");
    const line = logs.info[0];
    assert(
      /was: 7\b/.test(line),
      `info line should carry old neuron count 7 after 'was:', got: ${line}`,
    );
    assert(
      /was: 12\b/.test(line),
      `info line should carry old synapse count 12 after 'was:', got: ${line}`,
    );
    assert(
      line.includes("Predictive-coding compacting"),
      `info line should say Predictive-coding compacting, got: ${line}`,
    );
  },
);

Deno.test(
  "logApproach: predictive-coding logs the training result without throwing (issue #4188)",
  () => {
    const fittest = createTestCreatureWithApproach(0.9, "predictive-coding");
    addTag(fittest, "trainID", "pc-train-2");
    const previous = createPreviousCreature(0.8);

    // A throw from logApproach would fail this test here.
    const logs = captureLogs(() => logApproach(fittest, previous));

    assertEquals(logs.info.length, 1, "expected exactly one info line");
    assertEquals(logs.warn.length, 0, "expected no warn lines");
    const line = logs.info[0];
    assert(
      line.includes("pc-train-2"),
      `info line should carry the trainID, got: ${line}`,
    );
    assert(
      line.includes("Predictive coding"),
      `info line should say Predictive coding, got: ${line}`,
    );
  },
);

Deno.test(
  "logApproach: every member of Approach is accepted without a warning (issue #4188)",
  () => {
    const previous = createPreviousCreature(0.8);

    for (const approach of Object.keys(EVERY_APPROACH) as Approach[]) {
      // Only the score and approach tags: no trainID, discoveryID or old-* tags.
      const fittest = createTestCreatureWithApproach(0.9, approach);

      const logs = captureLogs(() => logApproach(fittest, previous));

      assertEquals(
        logs.info.length,
        1,
        `approach '${approach}' should log exactly one info line`,
      );
      assertEquals(
        logs.warn.length,
        0,
        `approach '${approach}' should not warn`,
      );
    }
  },
);

Deno.test(
  "logApproach: compact without old-neurons/old-synapses tags logs 'was: unknown' (issue #4188)",
  () => {
    const fittest = createTestCreatureWithApproach(0.9, "compact");
    const previous = createPreviousCreature(0.8);

    // A throw from logApproach would fail this test here.
    const logs = captureLogs(() => logApproach(fittest, previous));

    assertEquals(logs.info.length, 1, "expected exactly one info line");
    assert(
      logs.info[0].includes("was: unknown"),
      `info line should say 'was: unknown', got: ${logs.info[0]}`,
    );
  },
);
