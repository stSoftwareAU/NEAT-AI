/**
 * Issue #2392: the 🚨 alarm emoji in log lines is detected by the external
 * GRQ-health monitor as an error. The warn-level "clamp" messages emitted
 * when overflowing weights/biases are reduced to safe magnitudes are NOT
 * genuine errors — they are informational guards that the pipeline handled
 * the overflow safely. Using 🚨 for those warnings caused false-positive
 * worker-error alerts on the dashboard.
 *
 * These tests lock in the contract:
 *   - Warn-level clamp messages MUST NOT contain 🚨.
 *   - Warn-level clamp messages MUST contain the clamp emoji 🗜️ so
 *     operators can still find them quickly in logs.
 *   - Error-level diagnostics (corruption, validation failures) are
 *     unaffected and still use 🚨 (covered by their existing tests).
 *
 * @module
 */

import { assert } from "@std/assert";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { Creature } from "@creature";
import { calculate } from "@architecture/Score.ts";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";

const ALARM_EMOJI = "\u{1F6A8}"; // 🚨
const CLAMP_EMOJI = "\u{1F5DC}"; // 🗜️

type LoggedCall = { level: string; args: unknown[] };

function captureLogs(run: () => void): LoggedCall[] {
  const calls: LoggedCall[] = [];
  const testLogger: Logger = {
    debug: () => {},
    info: (...args: unknown[]) => calls.push({ level: "info", args }),
    warn: (...args: unknown[]) => calls.push({ level: "warn", args }),
    error: (...args: unknown[]) => calls.push({ level: "error", args }),
  };
  const previous = getLogger();
  setLogger(testLogger);
  try {
    run();
  } finally {
    setLogger(previous);
  }
  return calls;
}

function findWarnContaining(
  calls: LoggedCall[],
  needle: string,
): LoggedCall | undefined {
  return calls.find((c) =>
    c.level === "warn" &&
    c.args.some((a) => typeof a === "string" && a.includes(needle))
  );
}

Deno.test(
  "Issue #2392: loadFrom clamp warning does not use 🚨 alarm emoji",
  () => {
    const json: CreatureExport = {
      input: 1,
      output: 1,
      neurons: [
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        {
          fromUUID: "input-0",
          toUUID: "output-0",
          weight: 1.1559466326634707e+195,
        },
      ],
    };

    const calls = captureLogs(() => {
      Creature.fromJSON(json);
    });

    const clampWarn = findWarnContaining(calls, "Clamped overflowing");
    assert(
      clampWarn !== undefined,
      `Expected a warn-level "Clamped overflowing" log. Got: ${
        JSON.stringify(calls)
      }`,
    );

    const text = clampWarn.args.filter((a) => typeof a === "string").join(" ");
    assert(
      !text.includes(ALARM_EMOJI),
      `loadFrom clamp warning must not contain the 🚨 alarm emoji ` +
        `(triggers GRQ-health false-positive errors). Got: ${text}`,
    );
    assert(
      text.includes(CLAMP_EMOJI),
      `loadFrom clamp warning should contain the 🗜️ clamp emoji ` +
        `so operators can find it in logs. Got: ${text}`,
    );
  },
);

Deno.test(
  "Issue #2392: Score overflow clamp warning does not use 🚨 alarm emoji",
  () => {
    const creature = new Creature(1, 1);
    creature.uuid = "00000000-0000-4000-8000-000000002392";
    if (creature.synapses.length === 0) return;
    creature.synapses[0].weight = 1.1559466326634707e+195;
    creature.invalidateScoreCache();

    const calls = captureLogs(() => {
      calculate(creature, 0.1, 0.000_1);
    });

    const overflowWarn = findWarnContaining(
      calls,
      "Weight/bias magnitude overflow",
    );
    assert(
      overflowWarn !== undefined,
      `Expected a warn-level "Weight/bias magnitude overflow" log. Got: ${
        JSON.stringify(calls)
      }`,
    );

    const text = overflowWarn.args
      .filter((a) => typeof a === "string")
      .join(" ");
    assert(
      !text.includes(ALARM_EMOJI),
      `Score clamp warning must not contain the 🚨 alarm emoji ` +
        `(triggers GRQ-health false-positive errors). Got: ${text}`,
    );
    assert(
      text.includes(CLAMP_EMOJI),
      `Score clamp warning should contain the 🗜️ clamp emoji ` +
        `so operators can find it in logs. Got: ${text}`,
    );
  },
);
