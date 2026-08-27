/**
 * Recurrent directory-mode capability probe (Issue #3870).
 *
 * The probe decides whether `Fitness` may put `forwardOnly=false` creatures
 * into a batch. Getting it wrong in one direction wastes the batch (recurrent
 * creatures keep taking the per-creature path); getting it wrong in the other
 * hands a supporting-binary assumption to a binary that refuses, which under
 * the strict default is a hard run failure. These tests pin both answers
 * against a stand-in for the binary.
 */
import { assert, assertEquals, assertFalse } from "@std/assert";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import { resolveRecurrentDirectorySupport } from "../../src/score/RecurrentDirectoryProbe.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";

/** The load-time refusal an older `rust_scorer` emits (NEAT-AI-scorer#579). */
const LEGACY_REFUSAL =
  "Error: Creature '/tmp/x/rec.json' has forwardOnly=false; multi-creature " +
  "directory mode requires forwardOnly=true for every creature";

function config(
  overrides: Partial<RequiredRustScorerConfig> = {},
): RequiredRustScorerConfig {
  return {
    enabled: true,
    // Unique per test so each gets its own probe-cache entry.
    binaryPath: `/nonexistent/rust_scorer-${crypto.randomUUID()}`,
    timeoutMs: 5_000,
    env: {},
    batch: true,
    ...overrides,
  };
}

/** Read the stems the scorer would see in a creatures directory. */
async function stemsIn(dir: string): Promise<string[]> {
  const stems: string[] = [];
  for await (const entry of Deno.readDir(dir)) {
    if (entry.isFile && entry.name.endsWith(".json")) {
      stems.push(entry.name.replace(/\.json$/, ""));
    }
  }
  return stems.sort();
}

Deno.test("Recurrent probe - a supporting scorer reports the capability", async () => {
  __resetRustScorerBridgeForTests();
  const tmp = await Deno.makeTempDir({ prefix: "recurrent-probe-test-" });
  let probedStems: string[] = [];
  let probedCreature = "";
  try {
    __setRustScorerRunnerForTests(async (_command, args) => {
      if (args.length === 1 && args[0] === "--help") {
        return { success: true, code: 0, stdout: "usage --cost", stderr: "" };
      }
      probedStems = await stemsIn(args[0]);
      probedCreature = await Deno.readTextFile(
        `${args[0]}/${probedStems[0]}.json`,
      );
      const payload: Record<string, unknown> = {};
      for (const stem of probedStems) {
        payload[stem] = { score: 0.5, error: 0.25, recordCount: 4 };
      }
      return {
        success: true,
        code: 0,
        stdout: JSON.stringify(payload),
        stderr: "",
      };
    });

    assert(
      await resolveRecurrentDirectorySupport(config(), tmp),
      "a scorer that scores the probe creature supports recurrent batching",
    );
    assertEquals(probedStems.length, 1, "the probe sends exactly one creature");
    const creature = JSON.parse(probedCreature);
    assertEquals(
      creature.forwardOnly,
      false,
      "the probe creature must be recurrent, or the probe proves nothing",
    );
    assert(
      creature.synapses.some((s: { fromUUID: string; toUUID: string }) =>
        s.fromUUID === "output-0" && s.toUUID === "hidden-0"
      ),
      "the probe creature must carry a genuine back edge",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("Recurrent probe - a legacy scorer that refuses the batch reports no capability", async () => {
  __resetRustScorerBridgeForTests();
  const tmp = await Deno.makeTempDir({ prefix: "recurrent-probe-test-" });
  try {
    __setRustScorerRunnerForTests((_command, args) => {
      if (args.length === 1 && args[0] === "--help") {
        return Promise.resolve({
          success: true,
          code: 0,
          stdout: "usage --cost",
          stderr: "",
        });
      }
      return Promise.resolve({
        success: false,
        code: 1,
        stdout: "",
        stderr: LEGACY_REFUSAL,
      });
    });

    assertFalse(
      await resolveRecurrentDirectorySupport(config(), tmp),
      "a scorer that refuses the probe batch must not be assumed capable",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("Recurrent probe - unusable output counts as no capability", async () => {
  __resetRustScorerBridgeForTests();
  const tmp = await Deno.makeTempDir({ prefix: "recurrent-probe-test-" });
  try {
    __setRustScorerRunnerForTests((_command, args) => {
      if (args.length === 1 && args[0] === "--help") {
        return Promise.resolve({
          success: true,
          code: 0,
          stdout: "usage",
          stderr: "",
        });
      }
      // Exit 0 but no result for the probe creature — a "success" we must not
      // build a capability assumption on.
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "{}",
        stderr: "",
      });
    });

    assertFalse(
      await resolveRecurrentDirectorySupport(config(), tmp),
      "an empty result map is not evidence of recurrent support",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("Recurrent probe - an unavailable binary is not probed at all", async () => {
  __resetRustScorerBridgeForTests();
  const tmp = await Deno.makeTempDir({ prefix: "recurrent-probe-test-" });
  let probeCalls = 0;
  try {
    __setRustScorerRunnerForTests((_command, args) => {
      if (args.length === 1 && args[0] === "--help") {
        return Promise.reject(new Error("binary not found"));
      }
      probeCalls++;
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "{}",
        stderr: "",
      });
    });

    assertFalse(await resolveRecurrentDirectorySupport(config(), tmp));
    assertEquals(
      probeCalls,
      0,
      "no directory-mode probe should spawn when the binary is unavailable",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("Recurrent probe - the answer is cached per configuration", async () => {
  __resetRustScorerBridgeForTests();
  const tmp = await Deno.makeTempDir({ prefix: "recurrent-probe-test-" });
  let probeCalls = 0;
  try {
    __setRustScorerRunnerForTests(async (_command, args) => {
      if (args.length === 1 && args[0] === "--help") {
        return { success: true, code: 0, stdout: "usage", stderr: "" };
      }
      probeCalls++;
      const stems = await stemsIn(args[0]);
      const payload: Record<string, unknown> = {};
      for (const stem of stems) {
        payload[stem] = { score: 0.5, error: 0.25, recordCount: 4 };
      }
      return {
        success: true,
        code: 0,
        stdout: JSON.stringify(payload),
        stderr: "",
      };
    });

    const cfg = config();
    const [first, second] = await Promise.all([
      resolveRecurrentDirectorySupport(cfg, tmp),
      resolveRecurrentDirectorySupport(cfg, tmp),
    ]);
    const third = await resolveRecurrentDirectorySupport(cfg, tmp);

    assert(first && second && third, "every call answers the same capability");
    assertEquals(
      probeCalls,
      1,
      "concurrent and repeat callers must share one probe subprocess",
    );
  } finally {
    await Deno.remove(tmp, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});

Deno.test("Recurrent probe - probe files are cleaned up", async () => {
  __resetRustScorerBridgeForTests();
  const tmp = await Deno.makeTempDir({ prefix: "recurrent-probe-test-" });
  try {
    __setRustScorerRunnerForTests(async (_command, args) => {
      if (args.length === 1 && args[0] === "--help") {
        return { success: true, code: 0, stdout: "usage", stderr: "" };
      }
      const stems = await stemsIn(args[0]);
      return {
        success: true,
        code: 0,
        stdout: JSON.stringify(
          Object.fromEntries(
            stems.map((s) => [s, { score: 0.5, error: 0.25, recordCount: 4 }]),
          ),
        ),
        stderr: "",
      };
    });

    await resolveRecurrentDirectorySupport(config(), tmp);

    const leftOver: string[] = [];
    for await (const entry of Deno.readDir(tmp)) leftOver.push(entry.name);
    assertEquals(leftOver, [], `probe left files behind: ${leftOver}`);
  } finally {
    await Deno.remove(tmp, { recursive: true });
    __resetRustScorerBridgeForTests();
  }
});
