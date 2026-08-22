/**
 * @module
 *
 * `creatureValidate` has no fallback (Issue #3803): when the NEAT-AI-core
 * bundle cannot be loaded it must **throw**, never quietly report a creature
 * as valid because the rules were never run. That is the worst failure mode
 * this change could have, and it is invisible to every other test — a silent
 * skip would make the whole suite greener, not redder.
 *
 * Proving it needs a process where the bundle really is unavailable, so each
 * case runs a probe in a child `deno run` and asserts on what the probe
 * reports back. Two ways of being unavailable are covered:
 *
 * 1. the module was never initialised (auto-init skipped), and
 * 2. initialisation was attempted and failed — here by denying read access to
 *    `wasm_activation/`, which is the shape a JSR consumer hits.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { dirname, fromFileUrl, resolve } from "@std/path";

const REPO_ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "../..");

/**
 * A probe that validates a healthy creature and prints what happened.
 *
 * `setSkipWasmAutoInit` has to run before anything pulls NEAT-AI in, so the
 * library is imported dynamically after the flag is set.
 */
const PROBE = `
import { setSkipWasmAutoInit } from "@globalAccessors";

if (Deno.args[0] === "skip-auto-init") {
  setSkipWasmAutoInit(true);
}

const { Creature } = await import("@creature");
const { creatureValidate } = await import(
  "@architecture/CreatureValidate.ts"
);

const creature = new Creature(2, 1, { layers: [{ count: 1 }] });
creature.DEBUG = false;

try {
  const stats = creatureValidate(creature);
  console.log(JSON.stringify({ outcome: "passed", stats }));
} catch (error) {
  console.log(JSON.stringify({
    outcome: "threw",
    name: error?.name,
    reason: error?.reason,
    message: String(error?.message),
    cause: error?.cause ? String(error.cause) : null,
  }));
}
`;

interface ProbeOutcome {
  outcome: "passed" | "threw";
  name?: string;
  reason?: string;
  message?: string;
  cause?: string | null;
}

/** Runs the probe in a child process and returns what it reported. */
async function runProbe(
  mode: "skip-auto-init" | "deny-read",
): Promise<ProbeOutcome> {
  const dir = await Deno.makeTempDir({ prefix: "neat-no-wasm-probe-" });
  const script = `${dir}/probe.ts`;
  await Deno.writeTextFile(script, PROBE);
  try {
    const permissions = mode === "deny-read"
      ? ["--allow-all", `--deny-read=${REPO_ROOT}/wasm_activation`]
      : ["--allow-all"];
    const command = new Deno.Command(Deno.execPath(), {
      args: [
        "run",
        "--config",
        `${REPO_ROOT}/deno.json`,
        ...permissions,
        script,
        mode,
      ],
      stdout: "piped",
      stderr: "piped",
    });
    const { stdout, stderr } = await command.output();
    const text = new TextDecoder().decode(stdout);
    const line = text.trim().split("\n").filter((l) => l.startsWith("{")).pop();
    assert(
      line,
      `probe printed no verdict.\nstdout: ${text}\nstderr: ${
        new TextDecoder().decode(stderr)
      }`,
    );
    return JSON.parse(line) as ProbeOutcome;
  } finally {
    await Deno.remove(dir, { recursive: true });
  }
}

Deno.test(
  "Issue #3803: creatureValidate throws when the bundle was never initialised",
  async () => {
    const result = await runProbe("skip-auto-init");

    assertEquals(
      result.outcome,
      "threw",
      `a creature must never pass validation that did not run: ${
        JSON.stringify(result)
      }`,
    );
    assertEquals(result.name, "WasmError");
    assertEquals(result.reason, "MODULE_NOT_LOADED");
    assertStringIncludes(result.message ?? "", "no TypeScript fallback");
    assertStringIncludes(result.message ?? "", "never initialised");
  },
);

Deno.test(
  "Issue #3803: creatureValidate surfaces the loader error when the bundle cannot be read",
  async () => {
    const result = await runProbe("deny-read");

    assertEquals(
      result.outcome,
      "threw",
      `a creature must never pass validation that did not run: ${
        JSON.stringify(result)
      }`,
    );
    assertEquals(result.name, "WasmError");
    assertEquals(result.reason, "MODULE_NOT_LOADED");
    assertStringIncludes(result.message ?? "", "Underlying load error:");
    assert(
      result.cause !== null && result.cause !== undefined,
      `the loader failure must travel as the cause: ${JSON.stringify(result)}`,
    );
  },
);
