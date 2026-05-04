/**
 * Issue #2500: when `loadFrom` strips a recurrent synapse from a
 * forward-only creature, the warning must include
 *  - a usable creature identifier (uuid OR `hash:<8hex>` fallback)
 *  - a `source=...` tag describing the upstream pipeline
 *
 * Without these, GRQ logs show `UUID: unknown` for every event and the
 * upstream corruption source cannot be traced (regression of GRQ#1497,
 * GRQ#1906).
 */
import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import { fromJSON, loadFrom } from "@creature/CreatureSerialization.ts";
import { getLogger } from "@utils/Logger.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { initWasmForTests } from "../_initWasm.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = false;

/** Build an export-shaped JSON for a forward-only creature with a
 *  poisoned recurrent synapse (output -> hidden self-loop is forward-only
 *  invalid). The `uuid` field is intentionally omitted so the test
 *  exercises the structural-hash fallback path. */
function makeForwardOnlyExportWithRecurrent(): CreatureExport {
  return {
    semanticVersion: "4.0.0",
    forwardOnly: true,
    input: 2,
    output: 1,
    neurons: [
      // hidden at index 2
      { type: "hidden", uuid: "h-1", squash: "IDENTITY", bias: 0 },
      // output at index 3
      { type: "output", uuid: "o-0", squash: "IDENTITY", bias: 0 },
    ],
    // input-0 (idx 0) -> hidden (idx 2),
    // hidden -> output, plus a recurrent output -> output self-loop.
    synapses: [
      { fromUUID: "input-0", toUUID: "h-1", weight: 0.1 },
      { fromUUID: "h-1", toUUID: "o-0", weight: 0.2 },
      { fromUUID: "o-0", toUUID: "o-0", weight: 0.3 },
    ],
  } as unknown as CreatureExport;
}

Deno.test("loadFrom strip warning: no longer says 'UUID: unknown'", async () => {
  await initWasmForTests();

  const logger = getLogger();
  const original = logger.error.bind(logger);
  const captured: string[] = [];
  logger.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
  try {
    // Issue #2514: the load-side throw is the new default. To keep
    // exercising the legacy strip+warn path verified by this test,
    // opt back into the legacy behaviour explicitly.
    const creature = fromJSON(
      makeForwardOnlyExportWithRecurrent(),
      false,
      Creature,
      "fromJSON",
      { throwOnRecurrent: "never" },
    );
    assert(creature, "fromJSON must still produce a creature");
  } finally {
    logger.error = original;
  }

  const stripWarnings = captured.filter((m) =>
    m.includes("Stripping recurrent synapse")
  );
  assert(stripWarnings.length > 0, "expected at least one strip warning");
  for (const w of stripWarnings) {
    assert(
      !/UUID:\s*unknown/.test(w),
      `Issue #2500: warning must not include 'UUID: unknown'; got: ${w}`,
    );
    assert(
      /UUID:\s*(?:[0-9a-f-]{8,}|hash:[0-9a-f]{8})/i.test(w),
      `Issue #2500: warning must include uuid or hash:<8hex>; got: ${w}`,
    );
    assert(
      /source=/.test(w),
      `Issue #2500: warning must include source=...; got: ${w}`,
    );
  }
});

Deno.test("loadFrom strip warning: source=... reflects caller tag", async () => {
  await initWasmForTests();

  const logger = getLogger();
  const original = logger.error.bind(logger);
  const captured: string[] = [];
  logger.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
  try {
    const target = new Creature(2, 1, { feedbackEnabled: false });
    target.forwardOnly = true;
    // Issue #2514: opt into the legacy strip+warn path so the source
    // tag assertion below continues to exercise warning emission.
    loadFrom(
      target,
      makeForwardOnlyExportWithRecurrent(),
      false,
      "unit-test:custom-source",
      { throwOnRecurrent: "never" },
    );
  } finally {
    logger.error = original;
  }

  const stripWarnings = captured.filter((m) =>
    m.includes("Stripping recurrent synapse")
  );
  assert(stripWarnings.length > 0, "expected strip warnings");
  for (const w of stripWarnings) {
    assert(
      w.includes("source=unit-test:custom-source"),
      `expected source tag in warning, got: ${w}`,
    );
  }
});

Deno.test("loadFrom strip warning: same JSON yields the same hash twice", async () => {
  await initWasmForTests();

  const logger = getLogger();
  const original = logger.error.bind(logger);
  const captured: string[] = [];
  logger.error = (...args: unknown[]) => {
    captured.push(args.map(String).join(" "));
  };
  try {
    const j1 = makeForwardOnlyExportWithRecurrent();
    const j2 = makeForwardOnlyExportWithRecurrent();
    // Issue #2514: opt into the legacy strip+warn path so the
    // structural-hash assertion below continues to exercise warning
    // emission for identical JSON.
    fromJSON(j1, false, Creature, "fromJSON", { throwOnRecurrent: "never" });
    fromJSON(j2, false, Creature, "fromJSON", { throwOnRecurrent: "never" });
  } finally {
    logger.error = original;
  }

  const hashes = new Set<string>();
  const re = /hash:([0-9a-f]{8})/;
  for (const w of captured) {
    const m = w.match(re);
    if (m) hashes.add(m[1]);
  }
  assertEquals(
    hashes.size,
    1,
    `expected the same structural hash for identical JSON, got ${
      [...hashes].join(", ")
    }`,
  );
});
