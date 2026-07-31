/**
 * Issue #3277 — verifies the config-key reference table in
 * docs/api/CONFIGURATION.md matches the source of truth in
 * src/config/NeatConfig.ts (and AdaptiveMutationThresholds.ts).
 *
 * These are "what" tests: they read the actual doc (data) and the actual
 * source constants, then assert the documented defaults and semantics agree
 * with the code. They fail if the doc drifts from the source again.
 */

import { assert, assertRejects } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";
import { DEFAULT_HEAVY_TASK_WORKER_COUNT } from "@config/NeatConfig.ts";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const CONFIG_DOC = `${REPO_ROOT}/docs/api/CONFIGURATION.md`;

/** Return the trimmed cells of the first markdown table row whose first cell
 * contains the given field name in backticks. */
async function tableRow(field: string): Promise<string[]> {
  const content = await Deno.readTextFile(CONFIG_DOC);
  const needle = `\`${field}\``;
  for (const line of content.split("\n")) {
    if (!line.trimStart().startsWith("|")) continue;
    const cells = line.split("|").slice(1, -1).map((c) => c.trim());
    if (cells.length > 0 && cells[0].includes(needle)) return cells;
  }
  throw new Error(`No table row found for field \`${field}\` in ${CONFIG_DOC}`);
}

Deno.test("CONFIGURATION.md - threads default reflects hardwareConcurrency + heavyTaskWorkerCount", async () => {
  const [, , def] = await tableRow("threads");
  // The source computes hardwareConcurrency + DEFAULT_HEAVY_TASK_WORKER_COUNT,
  // not a bare hardwareConcurrency. The row must show the "+ N" addend.
  assert(
    def.includes(`+ ${DEFAULT_HEAVY_TASK_WORKER_COUNT}`),
    `threads default must document "+ ${DEFAULT_HEAVY_TASK_WORKER_COUNT}", got: ${def}`,
  );
});

Deno.test("CONFIGURATION.md - adaptiveMutationThresholds medium/large are neuron counts", async () => {
  const fields = ["medium", "large"];
  const rows = await Promise.all(fields.map((f) => tableRow(f)));
  fields.forEach((field, i) => {
    const desc = rows[i][3];
    assert(
      /neuron/i.test(desc),
      `${field} must be a neuron count threshold: ${desc}`,
    );
    assert(
      !/synapse/i.test(desc),
      `${field} must not be labelled a synapse count: ${desc}`,
    );
  });
});

Deno.test("CONFIGURATION.md - verbose is not conflated with debug", async () => {
  const desc = (await tableRow("verbose"))[3];
  assert(
    !/debug/i.test(desc),
    `verbose description must not mention debug (that is a separate flag): ${desc}`,
  );
});

Deno.test("CONFIGURATION.md - documented defaults still match code", () => {
  // Guards the numeric source-of-truth the doc now cites.
  assert(DEFAULT_HEAVY_TASK_WORKER_COUNT === 2);
});

// Issue #3552: the two growth-cap knobs were removed, so the doc table must no
// longer advertise them.
Deno.test("CONFIGURATION.md - removed growth-cap options are not documented", async () => {
  await Promise.all(
    ["maxConns", "maximumNumberOfNodes"].map((field) =>
      assertRejects(
        () => tableRow(field),
        Error,
        "No table row found",
        `${field} was removed by #3552 and must not be documented`,
      )
    ),
  );
});
