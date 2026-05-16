/**
 * Issue #2683 — Replay GRQ-logs/Develop WASM compile-trap samples on the
 * current Develop branch and pin the result as a regression test.
 *
 * Background:
 *
 *   The `stSoftwareAU/GRQ-logs` repository (Develop branch) captured nine
 *   offspring/mother/father/error quadruples from creatures that tripped
 *   `RuntimeError: unreachable` inside `CompiledNetwork::new` during
 *   breeding on 2026-05-15. The offending shape is ~1670 neurons, 2461
 *   inputs, 1 output, forward-only — much larger than the lunar_lander
 *   reproducer pinned by #2668 and structurally different.
 *
 *   PR #2678 fixed a position-blind topology-hash collision that produced
 *   the same `unreachable` trap for the lunar_lander shape. This test
 *   verifies whether the same fix also resolves the GRQ-cluster shape:
 *
 *     - If yes (all nine fixtures compile cleanly), #2681 is resolved by
 *       the upstream #2678 + #2682 work.
 *     - If no, the test surfaces the still-failing trap messages so
 *       #2684 inherits a deterministic, in-tree reproducer.
 *
 *   The fixtures live under `test/fixtures/wasm-compile-traps/grq-2681/`
 *   as `*.json.gz` (each raw JSON is ~3.5 MB, ~415 KB gzipped) so the
 *   repository stays a manageable size. No network access is required —
 *   the gz files are decompressed in-memory at test time.
 */

import { assert } from "@std/assert";
import { Creature } from "@creature";
import { ensureProducerOutputCompiles } from "@wasm/ProducerCompileGuard.ts";
import { initWasmForTests } from "../_initWasm.ts";

const FIXTURE_DIR = new URL(
  "../fixtures/wasm-compile-traps/grq-2681/",
  import.meta.url,
);

/**
 * Load and decompress a gzipped JSON fixture into a parsed object. Uses
 * the platform `DecompressionStream` (available in Deno) so no extra
 * dependency is needed.
 */
async function readGzippedJson(fileUrl: URL): Promise<unknown> {
  const compressed = await Deno.readFile(fileUrl);
  const stream = new Blob([compressed]).stream().pipeThrough(
    new DecompressionStream("gzip"),
  );
  const text = await new Response(stream).text();
  return JSON.parse(text);
}

interface ReplayOutcome {
  readonly fixture: string;
  readonly status: "ok" | "repaired" | "failed";
  readonly trapMessage?: string;
  readonly neurons: number;
  readonly inputs: number;
  readonly outputs: number;
}

/**
 * List every gzipped fixture in the directory, sorted alphabetically so
 * the test report is deterministic across runs.
 */
async function listFixtures(): Promise<string[]> {
  const names: string[] = [];
  for await (const entry of Deno.readDir(FIXTURE_DIR)) {
    if (entry.isFile && entry.name.endsWith(".json.gz")) {
      names.push(entry.name);
    }
  }
  names.sort();
  return names;
}

async function replayFixture(name: string): Promise<ReplayOutcome> {
  const json = await readGzippedJson(new URL(name, FIXTURE_DIR));
  // `Creature.fromJSON` is the in-process trusted round-trip; the issue
  // specifies this exact loader. The captured genome is the producer
  // output that originally tripped the gate — we want it loaded verbatim
  // before re-running the probe.
  const creature = Creature.fromJSON(
    json as Parameters<typeof Creature.fromJSON>[0],
    false,
    `grq-2681:${name}`,
  );
  const probe = ensureProducerOutputCompiles(creature);
  const meta = {
    fixture: name,
    neurons: creature.neurons.length,
    inputs: creature.input,
    outputs: creature.output,
  };
  if (probe.ok && probe.repaired) {
    return { ...meta, status: "repaired" };
  }
  if (probe.ok) {
    return { ...meta, status: "ok" };
  }
  return {
    ...meta,
    status: "failed",
    trapMessage: probe.trapMessage ?? "unknown trap",
  };
}

Deno.test({
  // `sanitizeOps: false` is required because module-level WASM init from
  // `initWasmForTests` keeps a pre-warmed module alive across the test —
  // exactly the pattern documented in the issue's acceptance criteria.
  name:
    "Issue #2683: GRQ-logs WASM-compile-trap samples now compile cleanly on Develop",
  sanitizeOps: false,
  sanitizeResources: false,
  fn: async () => {
    await initWasmForTests();
    const fixtures = await listFixtures();
    assert(
      fixtures.length >= 5,
      `expected at least 5 captured offspring fixtures, found ${fixtures.length}`,
    );

    const outcomes: ReplayOutcome[] = [];
    for (const fixture of fixtures) {
      // Sequential await is intentional: each fixture parses a ~3.5 MB
      // JSON and compiles a ~1670-neuron WASM module. Running them in
      // parallel would blow the WASM compile cache budget and hide
      // per-fixture trap attribution.
      // deno-lint-ignore no-await-in-loop
      const outcome = await replayFixture(fixture);
      outcomes.push(outcome);
      const tail = outcome.trapMessage ? ` trap=${outcome.trapMessage}` : "";
      console.log(
        `[Grq2681TrapReplay] ${outcome.fixture} -> ${outcome.status} ` +
          `(neurons=${outcome.neurons}, inputs=${outcome.inputs}, ` +
          `outputs=${outcome.outputs})${tail}`,
      );
    }

    const failures = outcomes.filter((o) => o.status === "failed");
    const repaired = outcomes.filter((o) => o.status === "repaired");
    const ok = outcomes.filter((o) => o.status === "ok");
    console.log(
      `[Grq2681TrapReplay] summary: ok=${ok.length}, ` +
        `repaired=${repaired.length}, failed=${failures.length}, ` +
        `total=${outcomes.length}`,
    );

    // Acceptance criterion: zero failures on current Develop confirms
    // that #2678 also resolves the GRQ-cluster shape. If some still
    // fail, the assertion message surfaces the deterministic list so
    // #2684 can root-cause them — do NOT mask the failures by raising
    // an allowance.
    if (failures.length > 0) {
      const detail = failures
        .map((f) => `${f.fixture}: ${f.trapMessage ?? "unknown trap"}`)
        .join("\n  ");
      throw new Error(
        `Issue #2683: ${failures.length} of ${outcomes.length} captured ` +
          `GRQ-cluster offspring still trap on Develop. ` +
          `If this regressed, #2684 root-cause work needs these traps:\n  ${detail}`,
      );
    }
  },
});
