/**
 * Issue #3277 — verifies the config-key reference table in
 * docs/api/CONFIGURATION.md matches the source of truth in
 * src/config/NeatConfig.ts (and AdaptiveMutationThresholds.ts).
 *
 * These are "what" tests: they read the actual doc (data) and the actual
 * source constants, then assert the documented defaults and semantics agree
 * with the code. They fail if the doc drifts from the source again.
 */

import { assert } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";
import { DEFAULT_HEAVY_TASK_WORKER_COUNT } from "@config/NeatConfig.ts";
import { createNeatConfig } from "@config/NeatConfig.ts";

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

Deno.test("CONFIGURATION.md - maxConns default is MAX_SAFE_INTEGER not Infinity", async () => {
  const [, , def] = await tableRow("maxConns");
  assert(def.includes("MAX_SAFE_INTEGER"), `maxConns default wrong: ${def}`);
  assert(!def.includes("Infinity"), `maxConns must not say Infinity: ${def}`);
});

Deno.test("CONFIGURATION.md - maximumNumberOfNodes default and semantics", async () => {
  const row = await tableRow("maximumNumberOfNodes");
  const def = row[2];
  const desc = row[3];
  assert(
    def.includes("MAX_SAFE_INTEGER"),
    `maximumNumberOfNodes default wrong: ${def}`,
  );
  assert(!def.includes("Infinity"), `must not say Infinity: ${def}`);
  // Caps all neurons, not only hidden neurons.
  assert(
    !/hidden/i.test(desc),
    `maximumNumberOfNodes must not be labelled "hidden": ${desc}`,
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
  const config = createNeatConfig({});
  assert(config.maxConns === Number.MAX_SAFE_INTEGER);
  assert(config.maximumNumberOfNodes === Number.MAX_SAFE_INTEGER);
  assert(DEFAULT_HEAVY_TASK_WORKER_COUNT === 2);
});
