/**
 * Tests for Issue #2378: the score overflow guard emits a warn-level log
 * that identifies the creature (via its UUID) so the offending lineage can
 * be traced.
 *
 * Previously the guard logged at `info` level without any creature
 * identifier, making the thousands of "Max is too large" lines in
 * production logs essentially useless for debugging.
 *
 * @module
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { calculate } from "@architecture/Score.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

function makeCreatureWithOverflowWeight(uuid: string): Creature {
  // Build a minimal creature, then force its weight past MAX_SAFE_INTEGER
  // directly (load-time clamp protects the public path, but the
  // incremental score path can still see such values arriving via
  // unclamped compaction multiplications).
  const creature = new Creature(1, 1);
  creature.uuid = uuid;
  // Minimal valid topology: input -> output
  if (creature.synapses.length === 0) {
    // Defensive: fall through; Creature(1,1) usually creates the synapse
    // but don't rely on that here.
    return creature;
  }
  creature.synapses[0].weight = 1.1559466326634707e+195;
  creature.invalidateScoreCache();
  return creature;
}

Deno.test(
  "Score: overflow guard warns with creature UUID",
  () => {
    const calls: { level: string; args: unknown[] }[] = [];
    const testLogger: Logger = {
      debug: () => {},
      info: (...args: unknown[]) => calls.push({ level: "info", args }),
      warn: (...args: unknown[]) => calls.push({ level: "warn", args }),
      error: (...args: unknown[]) => calls.push({ level: "error", args }),
    };
    const previous = getLogger();
    setLogger(testLogger);
    try {
      const uuid = "00000000-0000-4000-8000-000000002378";
      const creature = makeCreatureWithOverflowWeight(uuid);
      if (creature.synapses.length === 0) return; // skip if topology is empty
      calculate(creature, 0.1, 0.000_1);

      const matchingWarns = calls.filter((c) =>
        c.level === "warn" &&
        c.args.some((a) =>
          typeof a === "string" &&
          (a.includes("too large") || a.includes("overflow"))
        )
      );
      assert(
        matchingWarns.length > 0,
        `Expected warn-level log mentioning "too large" or "overflow"; got ${
          JSON.stringify(calls)
        }`,
      );

      // UUID must appear somewhere in the warn arguments so the offending
      // lineage can be traced in production logs.
      const anyMentionsUuid = matchingWarns.some((c) =>
        c.args.some((a) => typeof a === "string" && a.includes(uuid))
      );
      assertEquals(
        anyMentionsUuid,
        true,
        `Expected warn to include creature UUID ${uuid}; got ${
          JSON.stringify(matchingWarns)
        }`,
      );
    } finally {
      setLogger(previous);
    }
  },
);
