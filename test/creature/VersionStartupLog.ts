/**
 * Issue #2682: every worker logs the running @stsoftware/neat-ai version
 * once at startup so a stale pin (e.g. 5.0.13, missing the topology-hash
 * fix from PR #2678) is immediately visible.
 *
 * The first Creature constructed in a process must emit exactly one
 *
 *     [neat-ai] running version X.Y.Z[ (local)]
 *
 * line via the configured NEAT-AI Logger. Subsequent constructions in the
 * same process must NOT re-log.
 *
 * Issue #2720: the previous `FALLBACK_NEAT_AI_VERSION` constant duplicated
 * `deno.json` `version` and required a sync test to police drift. The
 * `file://` (local dev/test) load path now reads `deno.json` once instead,
 * giving a single source of truth — and the log line carries a `(local)`
 * suffix so it cannot be confused with the JSR-derived line.
 */

import { assert, assertEquals, assertMatch } from "@std/assert";
import { Creature } from "@creature";
import { getLogger, type Logger, setLogger } from "@utils/Logger.ts";
import {
  getNeatAiVersion,
  logNeatAiVersionOnce,
  resetNeatAiVersionLogForTest,
} from "@utils/Version.ts";

interface CapturedLog {
  level: "debug" | "info" | "warn" | "error";
  message: string;
}

function captureLogs(): { logs: CapturedLog[]; restore: () => void } {
  const logs: CapturedLog[] = [];
  const original = getLogger();
  const capturing: Logger = {
    debug: (...args: unknown[]) =>
      logs.push({ level: "debug", message: args.map(String).join(" ") }),
    info: (...args: unknown[]) =>
      logs.push({ level: "info", message: args.map(String).join(" ") }),
    warn: (...args: unknown[]) =>
      logs.push({ level: "warn", message: args.map(String).join(" ") }),
    error: (...args: unknown[]) =>
      logs.push({ level: "error", message: args.map(String).join(" ") }),
  };
  setLogger(capturing);
  return {
    logs,
    restore: () => setLogger(original),
  };
}

Deno.test("Version: getNeatAiVersion returns a valid semver string", () => {
  const v = getNeatAiVersion();
  assertMatch(
    v,
    /^\d+\.\d+\.\d+$/,
    `getNeatAiVersion() must return X.Y.Z, got ${v}`,
  );
});

Deno.test(
  "Version: local load path resolves the version from deno.json",
  async () => {
    // The test suite always runs from a local file:// load, so
    // getNeatAiVersion() must agree with deno.json `version` — that is the
    // single source of truth on the local path (Issue #2720).
    const denoJson = JSON.parse(await Deno.readTextFile("deno.json"));
    assertEquals(
      typeof denoJson.version,
      "string",
      "deno.json must define a string `version`",
    );
    assertEquals(
      getNeatAiVersion(),
      denoJson.version,
      "getNeatAiVersion() on the local file:// load path must read " +
        "`version` from deno.json (the single source of truth).",
    );
  },
);

Deno.test("Version: logNeatAiVersionOnce emits exactly once per process", () => {
  resetNeatAiVersionLogForTest();
  const { logs, restore } = captureLogs();
  try {
    logNeatAiVersionOnce();
    logNeatAiVersionOnce();
    logNeatAiVersionOnce();

    const versionLines = logs.filter((l) =>
      l.message.startsWith("[neat-ai] running version ")
    );
    assertEquals(
      versionLines.length,
      1,
      `expected exactly one [neat-ai] log line, got ${versionLines.length}: ` +
        JSON.stringify(logs),
    );
    assertEquals(versionLines[0].level, "info");
    // Local file:// load path appends the " (local)" suffix; JSR loads do not.
    assertMatch(
      versionLines[0].message,
      /^\[neat-ai\] running version \d+\.\d+\.\d+( \(local\))?$/,
    );
  } finally {
    restore();
  }
});

Deno.test(
  "Version: local file:// startup log carries the (local) suffix",
  () => {
    resetNeatAiVersionLogForTest();
    const { logs, restore } = captureLogs();
    try {
      logNeatAiVersionOnce();
      const versionLines = logs.filter((l) =>
        l.message.startsWith("[neat-ai] running version ")
      );
      assertEquals(versionLines.length, 1);
      // The test harness always loads modules via file://, so the log line
      // produced here must include the " (local)" disambiguator.
      assertEquals(
        versionLines[0].message,
        `[neat-ai] running version ${getNeatAiVersion()} (local)`,
      );
    } finally {
      restore();
    }
  },
);

Deno.test(
  "Version: first Creature construction logs version, subsequent do not",
  () => {
    resetNeatAiVersionLogForTest();
    const { logs, restore } = captureLogs();
    try {
      // First creature triggers the startup log.
      const c1 = new Creature(2, 1);
      assert(c1, "first creature should be constructed");

      // Many more creatures must NOT re-log.
      for (let i = 0; i < 5; i++) {
        new Creature(2, 1);
      }

      const versionLines = logs.filter((l) =>
        l.message.startsWith("[neat-ai] running version ")
      );
      assertEquals(
        versionLines.length,
        1,
        "Creature construction must emit the [neat-ai] log line exactly once " +
          `per process, got ${versionLines.length}`,
      );
      assertMatch(
        versionLines[0].message,
        /^\[neat-ai\] running version \d+\.\d+\.\d+( \(local\))?$/,
        `unexpected log format: ${versionLines[0].message}`,
      );
      // The logged version must match what getNeatAiVersion() returns. The
      // test harness loads modules via file://, so the suffix is present.
      assertEquals(
        versionLines[0].message,
        `[neat-ai] running version ${getNeatAiVersion()} (local)`,
      );
    } finally {
      restore();
    }
  },
);
