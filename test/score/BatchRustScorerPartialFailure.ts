/**
 * GRQ#4387 — a batch that loses one creature must not lose the rest.
 *
 * `rust_scorer` directory mode isolates a creature it cannot read, parse,
 * compile or score, emits a complete stem-keyed map with a `failed: true` entry
 * in that creature's place, and exits `3`. This bridge must consume that:
 * return the scores it did get, hand the offenders back to the caller, and keep
 * every strict-mode guarantee intact.
 *
 * The negative branch is the important one. "Score the rest" must never become
 * "quietly score fewer" — a stem that vanishes from the payload is still a hard
 * reconciliation failure, an offender is never handed a fabricated score, and a
 * batch in which *nothing* scored is still a batch failure.
 */

import { assert, assertEquals, assertRejects } from "@std/assert";
import { Creature } from "@creature";
import { makeDataDir } from "@architecture/DataSet.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import {
  __resetRustScorerBridgeForTests,
  __setRustScorerRunnerForTests,
} from "../../src/score/RustScorerBridge.ts";
import {
  SCORER_EXIT_CREATURE_FAILURES,
  tryBatchScoreWithRustScorer,
} from "../../src/score/BatchRustScorerBridge.ts";
import { BatchScorerError } from "../../src/score/BatchScorerReconciler.ts";
import { ScorerStrictError } from "@errors/ScorerStrictError.ts";
import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";
import { initWasmForTests } from "../_initWasm.ts";

function buildDataSet(): DataRecordInterface[] {
  const rows: DataRecordInterface[] = [];
  for (let i = 0; i < 8; i++) {
    const a = i / 8;
    const b = (8 - i) / 8;
    rows.push({
      input: new Float32Array([a, b]),
      output: new Float32Array([a > b ? 1 : -1]),
    });
  }
  return rows;
}

function buildConfig(
  overrides?: Partial<RequiredRustScorerConfig>,
): RequiredRustScorerConfig {
  return {
    enabled: true,
    binaryPath: "rust_scorer",
    timeoutMs: 0,
    env: {},
    batch: true,
    strict: false,
    ...overrides,
  };
}

function makeCreatureWithUuid(uuid: string): Creature {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  creature.uuid = uuid;
  return creature;
}

const OFFENDER_STDERR =
  "[creature-failed] poison: Failed compiling worker network for creature " +
  "'/tmp/neat-rust-scorer-batch-abc/poison.json': duplicate synapse input-7 -> hidden-2\n" +
  "Error: 1 creature(s) in the directory could not be scored\n";

/** Stub the probe + one scoring call returning `stdout` with exit `code`. */
function stubScorer(stdout: string, code: number, stderr = "") {
  __setRustScorerRunnerForTests((_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      return Promise.resolve({
        success: true,
        code: 0,
        stdout: "usage",
        stderr: "",
      });
    }
    return Promise.resolve({ success: code === 0, code, stdout, stderr });
  });
}

Deno.test("partial batch — survivors keep their scores, offender is named", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  stubScorer(
    JSON.stringify({
      alpha: { score: 0.9, error: 0.1, recordCount: 8 },
      poison: {
        failed: true,
        reason: "COMPILE",
        message:
          "Failed compiling worker network for creature '/tmp/x/poison.json': duplicate synapse",
      },
      beta: { score: 0.8, error: 0.2, recordCount: 8 },
    }),
    SCORER_EXIT_CREATURE_FAILURES,
    OFFENDER_STDERR,
  );

  const alpha = makeCreatureWithUuid("alpha");
  const poison = makeCreatureWithUuid("poison");
  const beta = makeCreatureWithUuid("beta");
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const run = await tryBatchScoreWithRustScorer(
      [alpha, poison, beta],
      dataDir,
      buildConfig(),
    );

    assertEquals(run.invocations, 1);
    assert(run.results, "the surviving creatures must still be scored");
    assertEquals(run.results.size, 2, "only the offender may be missing");
    assertEquals(run.results.get(alpha)?.error, 0.1);
    assertEquals(run.results.get(beta)?.error, 0.2);
    assertEquals(
      run.results.has(poison),
      false,
      "the offender must never be handed a score",
    );

    assertEquals(run.offenders.length, 1);
    assertEquals(run.offenders[0].stem, "poison");
    assertEquals(run.offenders[0].reason, "COMPILE");
    assertEquals(run.offenders[0].creature, poison);
    assert(
      run.offenders[0].message.includes("poison.json"),
      "the offender must carry the scorer's own message",
    );
  } finally {
    __resetRustScorerBridgeForTests();
    await Deno.remove(dataDir, { recursive: true });
  }
});

Deno.test("partial batch — strict mode surfaces offenders rather than aborting", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  stubScorer(
    JSON.stringify({
      alpha: { score: 0.9, error: 0.1, recordCount: 8 },
      poison: { failed: true, reason: "COMPILE", message: "poison.json: nope" },
    }),
    SCORER_EXIT_CREATURE_FAILURES,
    OFFENDER_STDERR,
  );

  const alpha = makeCreatureWithUuid("alpha");
  const poison = makeCreatureWithUuid("poison");
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    // Strict mode exists to stop a *dead* native path reconciling to a green
    // run (Issue #3815). A batch that ran and named its offender is not that:
    // the fault is reported, loudly and by name, so the generation continues.
    const run = await tryBatchScoreWithRustScorer(
      [alpha, poison],
      dataDir,
      buildConfig({ strict: true }),
    );
    assertEquals(run.results?.size, 1);
    assertEquals(run.offenders.map((o) => o.stem), ["poison"]);
  } finally {
    __resetRustScorerBridgeForTests();
    await Deno.remove(dataDir, { recursive: true });
  }
});

Deno.test("partial batch — a vanished stem is still a hard failure", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  // `beta` is simply absent: neither scored nor reported as an offender. That
  // is the silent-shrink failure mode, and it must not pass.
  stubScorer(
    JSON.stringify({
      alpha: { score: 0.9, error: 0.1, recordCount: 8 },
      poison: { failed: true, reason: "COMPILE", message: "poison.json: nope" },
    }),
    SCORER_EXIT_CREATURE_FAILURES,
    OFFENDER_STDERR,
  );

  const creatures = [
    makeCreatureWithUuid("alpha"),
    makeCreatureWithUuid("poison"),
    makeCreatureWithUuid("beta"),
  ];
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const err = await assertRejects(
      () => tryBatchScoreWithRustScorer(creatures, dataDir, buildConfig()),
      BatchScorerError,
    );
    assertEquals(err.reason, "MISSING_KEYS");
    assert(err.message.includes("beta"), `must name beta, got: ${err.message}`);
  } finally {
    __resetRustScorerBridgeForTests();
    await Deno.remove(dataDir, { recursive: true });
  }
});

Deno.test("partial batch — nothing scored is still a batch failure", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  stubScorer(
    JSON.stringify({
      "poison-a": { failed: true, reason: "COMPILE", message: "a.json: nope" },
      "poison-b": { failed: true, reason: "COMPILE", message: "b.json: nope" },
    }),
    SCORER_EXIT_CREATURE_FAILURES,
    OFFENDER_STDERR,
  );

  const creatures = [
    makeCreatureWithUuid("poison-a"),
    makeCreatureWithUuid("poison-b"),
  ];
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const err = await assertRejects(
      () => tryBatchScoreWithRustScorer(creatures, dataDir, buildConfig()),
      BatchScorerError,
    );
    assert(
      err.message.includes("scored none of 2"),
      `must say nothing scored, got: ${err.message}`,
    );
  } finally {
    __resetRustScorerBridgeForTests();
    await Deno.remove(dataDir, { recursive: true });
  }
});

Deno.test("partial batch — nothing scored under strict mode escalates", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  stubScorer(
    JSON.stringify({
      "poison-a": { failed: true, reason: "COMPILE", message: "a.json: nope" },
    }),
    SCORER_EXIT_CREATURE_FAILURES,
    OFFENDER_STDERR,
  );

  const creatures = [makeCreatureWithUuid("poison-a")];
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const err = await assertRejects(
      () =>
        tryBatchScoreWithRustScorer(
          creatures,
          dataDir,
          buildConfig({ strict: true }),
        ),
      ScorerStrictError,
    );
    assertEquals(err.exitCode, SCORER_EXIT_CREATURE_FAILURES);
    assert(
      err.stderr?.includes("poison"),
      "the scorer's stderr must be carried verbatim",
    );
  } finally {
    __resetRustScorerBridgeForTests();
    await Deno.remove(dataDir, { recursive: true });
  }
});

Deno.test("partial batch — an entry claiming both failed and a score is refused, not scored", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  // A fabricated score attached to a refusal is exactly what Issue #3815 was
  // raised for. The refusal must win.
  stubScorer(
    JSON.stringify({
      alpha: { score: 0.9, error: 0.1, recordCount: 8 },
      poison: {
        failed: true,
        reason: "COMPILE",
        message: "poison.json: nope",
        score: 0.99,
        error: 0.0,
        recordCount: 8,
      },
    }),
    SCORER_EXIT_CREATURE_FAILURES,
    OFFENDER_STDERR,
  );

  const alpha = makeCreatureWithUuid("alpha");
  const poison = makeCreatureWithUuid("poison");
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const run = await tryBatchScoreWithRustScorer(
      [alpha, poison],
      dataDir,
      buildConfig(),
    );
    assertEquals(run.results?.has(poison), false);
    assertEquals(run.offenders.map((o) => o.stem), ["poison"]);
  } finally {
    __resetRustScorerBridgeForTests();
    await Deno.remove(dataDir, { recursive: true });
  }
});

Deno.test("clean batch — exit 0 still returns no offenders", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  stubScorer(
    JSON.stringify({
      alpha: { score: 0.9, error: 0.1, recordCount: 8 },
      beta: { score: 0.8, error: 0.2, recordCount: 8 },
    }),
    0,
  );

  const creatures = [
    makeCreatureWithUuid("alpha"),
    makeCreatureWithUuid("beta"),
  ];
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    const run = await tryBatchScoreWithRustScorer(
      creatures,
      dataDir,
      buildConfig(),
    );
    assertEquals(run.results?.size, 2);
    assertEquals(run.offenders, []);
  } finally {
    __resetRustScorerBridgeForTests();
    await Deno.remove(dataDir, { recursive: true });
  }
});

Deno.test("exit 1 keeps the pre-GRQ#4387 whole-batch failure", async () => {
  await initWasmForTests();
  __resetRustScorerBridgeForTests();

  stubScorer("", 1, "Error: No .bin files found in training data directory\n");

  const creatures = [
    makeCreatureWithUuid("alpha"),
    makeCreatureWithUuid("beta"),
  ];
  const dataDir = makeDataDir(buildDataSet(), 8);
  try {
    await assertRejects(
      () => tryBatchScoreWithRustScorer(creatures, dataDir, buildConfig()),
      BatchScorerError,
    );
  } finally {
    __resetRustScorerBridgeForTests();
    await Deno.remove(dataDir, { recursive: true });
  }
});
