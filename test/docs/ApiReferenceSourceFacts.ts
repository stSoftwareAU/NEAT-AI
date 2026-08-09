/**
 * Issue #3696 — fact-check guard for the remaining `docs/api/` reference pages.
 *
 * A verification sweep found twelve claims in `COSTS_AND_ACTIVATIONS.md`,
 * `COMPUTE.md`, `INTEROP.md`, `EVOLUTION.md` and `CONFIGURATION.md` that
 * contradicted the source: a cost table missing `RMSE`, an activation
 * "Priority" column bearing no relation to the shipped `mutationProbability`
 * weights, samples that could not type-check, option keys that do not exist,
 * and a self-contradicting `requestedOptions` contract.
 *
 * These are "what" tests: each documented value is compared against the value
 * the shipped code actually produces — `Costs.find()`, `Activations.find()`,
 * `getCacheStats()`, `exportCheckpoint()`, `detectPlateau()` and
 * `serialiseOptionsEcho()` are all invoked for real. The markdown is read only
 * to extract the claim under test, never to grep the implementation.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, resolve } from "@std/path";
import { BUILT_IN_COST_NAMES, Costs } from "@costs";
import { Activations } from "@methods/activations/Activations.ts";
import { serialiseOptionsEcho } from "@creature/EvolveOptionsEcho.ts";
import {
  calculateOutputRangePenalty,
  Creature,
  detectPlateau,
  exportCheckpoint,
  getCacheStats,
  initialiseWasmActivationFromPayload,
} from "../../mod.ts";

const REPO_ROOT = resolve(fromFileUrl(import.meta.url), "..", "..", "..");
const API_DIR = `${REPO_ROOT}/docs/api`;

const COSTS_DOC = `${API_DIR}/COSTS_AND_ACTIVATIONS.md`;
const COMPUTE_DOC = `${API_DIR}/COMPUTE.md`;
const INTEROP_DOC = `${API_DIR}/INTEROP.md`;
const EVOLUTION_DOC = `${API_DIR}/EVOLUTION.md`;
const CONFIGURATION_DOC = `${API_DIR}/CONFIGURATION.md`;

/**
 * Cells of every markdown table row in `markdown` that has exactly
 * `columnCount` columns. Header, separator and prose rows are skipped.
 */
function tableRows(markdown: string, columnCount: number): string[][] {
  const rows: string[][] = [];
  for (const line of markdown.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("|") || !trimmed.endsWith("|")) continue;
    // Split on unescaped pipes only — `\|` inside a formula cell is content.
    const cells = trimmed.split(/(?<!\\)\|/).slice(1, -1).map((c) => c.trim());
    if (cells.length !== columnCount) continue;
    if (cells.every((c) => /^:?-+:?$/.test(c))) continue;
    rows.push(cells);
  }
  return rows;
}

/** Strip markdown emphasis and code fencing from a table cell. */
function plainCell(cell: string): string {
  return cell.replace(/[`*"]/g, "").trim();
}

Deno.test("COSTS_AND_ACTIVATIONS: built-in cost table lists every BUILT_IN_COST_NAMES entry", async () => {
  const markdown = await Deno.readTextFile(COSTS_DOC);
  const documented = tableRows(markdown, 4)
    .map((cells) => plainCell(cells[0]))
    .filter((name) =>
      (BUILT_IN_COST_NAMES as readonly string[]).includes(name)
    );

  assertEquals(
    new Set(documented),
    new Set<string>(BUILT_IN_COST_NAMES),
    "the built-in cost table must document exactly BUILT_IN_COST_NAMES",
  );

  // Every documented name must resolve to a real cost function.
  for (const name of documented) {
    const cost = Costs.find(name);
    assertEquals(cost.getName(), name);
  }
});

Deno.test("COSTS_AND_ACTIVATIONS: the built-in cost count in prose matches the tuple", async () => {
  const markdown = await Deno.readTextFile(COSTS_DOC);
  const WORDS = [
    "zero",
    "one",
    "two",
    "three",
    "four",
    "five",
    "six",
    "seven",
    "eight",
    "nine",
    "ten",
  ];
  const expected = WORDS[BUILT_IN_COST_NAMES.length];
  assert(expected !== undefined, "cost tuple outgrew the number-word table");

  // Prose is hard-wrapped by `deno fmt`, so match against a single-line view.
  const flattened = markdown.replace(/\s+/g, " ");
  const claims = flattened.match(
    /\b(zero|one|two|three|four|five|six|seven|eight|nine|ten)\b(?=[^.]{0,120}BUILT_IN_COST_NAMES)/g,
  ) ?? [];
  assert(claims.length > 0, "no prose count of BUILT_IN_COST_NAMES found");
  for (const claim of claims) {
    assertEquals(
      claim,
      expected,
      `prose says "${claim}" built-in costs, tuple has ${BUILT_IN_COST_NAMES.length}`,
    );
  }
});

Deno.test("COSTS_AND_ACTIVATIONS: RMSE is a working built-in cost", () => {
  const rmse = Costs.find("RMSE");
  assertEquals(rmse.getName(), "RMSE");
  const target = new Float32Array([1, 2, 3]);
  const output = new Float32Array([1, 2, 3]);
  assertEquals(rmse.calculate(target, output), 0);
});

Deno.test("COSTS_AND_ACTIVATIONS: activation table weights match mutationProbability", async () => {
  const markdown = await Deno.readTextFile(COSTS_DOC);
  const registered = new Map(
    Activations.list().map((a) => [a.getName(), a.mutationProbability]),
  );

  const documented = new Map<string, number>();
  for (const cells of tableRows(markdown, 4)) {
    const name = plainCell(cells[0]);
    if (!registered.has(name)) continue;
    const weight = Number(plainCell(cells[1]));
    assert(
      Number.isInteger(weight),
      `activation row "${name}" has a non-numeric weight cell "${cells[1]}"`,
    );
    documented.set(name, weight);
  }

  const missing = [...registered.keys()]
    .filter((name) => !documented.has(name))
    .sort();
  assertEquals(missing, [], "activation table is missing registered squashes");

  for (const [name, weight] of documented) {
    assertEquals(
      weight,
      registered.get(name),
      `documented weight for ${name} does not match its mutationProbability`,
    );
  }
});

Deno.test("COSTS_AND_ACTIVATIONS: no activation is described with the stale priority scale", async () => {
  const markdown = await Deno.readTextFile(COSTS_DOC);
  assertEquals(
    markdown.match(/priority\s+\d+/gi) ?? [],
    [],
    "prose still quotes the retired priority scale",
  );
});

Deno.test("COMPUTE: getCacheStats returns an array of per-cache stats", () => {
  const stats = getCacheStats();
  assert(Array.isArray(stats), "getCacheStats() must return an array");
  for (const entry of stats) {
    assertEquals(typeof entry.name, "string");
    assertEquals(typeof entry.hits, "number");
  }
});

Deno.test("COMPUTE: the getCacheStats sample declares the array return type", async () => {
  const markdown = await Deno.readTextFile(COMPUTE_DOC);
  const sample = markdown.match(/^.*getCacheStats\(\);\s*$/m)?.[0];
  assert(sample !== undefined, "getCacheStats() sample not found");
  assert(
    /:\s*CacheStats\[\]\s*=/.test(sample),
    `sample must annotate CacheStats[], got: ${sample.trim()}`,
  );
});

Deno.test("COMPUTE: the worker sample passes every required argument and awaits", async () => {
  // The real signature takes (payload, wasmRequired) and returns a Promise.
  assertEquals(initialiseWasmActivationFromPayload.length, 2);

  const markdown = await Deno.readTextFile(COMPUTE_DOC);
  const calls = [
    ...markdown.matchAll(/initialiseWasmActivationFromPayload\(([^)]*)\)/g),
  ];
  assert(calls.length > 0, "worker sample call not found");
  for (const [, args] of calls) {
    assertEquals(
      args.split(",").length,
      initialiseWasmActivationFromPayload.length,
      `every documented call must pass ${initialiseWasmActivationFromPayload.length} arguments, got: (${args})`,
    );
  }
  assert(
    /await\s+initialiseWasmActivationFromPayload/.test(markdown),
    "worker sample must await the returned promise",
  );
});

Deno.test("INTEROP: exportCheckpoint freezes neurons named by frozenNeuronIds", () => {
  const creature = new Creature(2, 1, { layers: [{ count: 2 }] });
  const hidden = creature.neurons.find((n) => n.type === "hidden");
  assert(hidden !== undefined, "expected a hidden neuron");

  const checkpoint = exportCheckpoint(creature, {
    sourceTask: "unit-test",
    frozenNeuronIds: [hidden.id],
  });
  assertEquals(checkpoint.frozenNeuronIds, [hidden.id]);
});

Deno.test("INTEROP: the checkpoint doc names frozenNeuronIds, not frozenNeuronUUIDs", async () => {
  const markdown = await Deno.readTextFile(INTEROP_DOC);
  assert(
    !markdown.includes("frozenNeuronUUIDs"),
    "INTEROP.md still documents the non-existent frozenNeuronUUIDs option",
  );
  assert(
    markdown.includes("frozenNeuronIds"),
    "INTEROP.md must document the real frozenNeuronIds option",
  );
  // The documented element type must be numeric, matching number[].
  const row = markdown.split("\n").find((l) =>
    l.includes("frozenNeuronIds") && l.trim().startsWith("|")
  );
  assert(row !== undefined, "frozenNeuronIds table row not found");
  assert(
    row.includes("number[]"),
    `frozenNeuronIds row must document number[], got: ${row.trim()}`,
  );
});

Deno.test("EVOLUTION: requestedOptions drops non-serialisable values with no marker", () => {
  const echo = serialiseOptionsEcho({
    populationSize: 10,
    onTrainingEvent: () => {},
    marker: Symbol("no-json"),
  });
  assertEquals(echo.populationSize, 10);
  assert(!("onTrainingEvent" in echo), "callbacks must be dropped entirely");
  assert(!("marker" in echo), "non-serialisable values must be dropped");
  assertEquals(
    JSON.stringify(echo),
    JSON.stringify({ populationSize: 10 }),
    "dropped options must leave no marker behind",
  );
});

Deno.test("EVOLUTION: the requestedOptions summary agrees with the detail section", async () => {
  const markdown = await Deno.readTextFile(EVOLUTION_DOC);
  // The bullet is hard-wrapped by `deno fmt`; take it up to the next bullet.
  const summary = markdown.match(
    /^- `requestedOptions`[\s\S]*?(?=\n- )/m,
  )?.[0];
  assert(summary !== undefined, "requestedOptions summary bullet not found");
  assert(
    /dropped/.test(summary),
    `summary must say non-serialisable values are dropped, got: ${summary.trim()}`,
  );
  assert(
    !/recorded by name with a marker/.test(markdown),
    "EVOLUTION.md still claims dropped values are recorded with a marker",
  );
});

Deno.test("EVOLUTION: detectPlateau is documented with its real parameter list", async () => {
  const result = detectPlateau([1, 1.01, 1.02, 1.02, 1.02], 3, 0.05);
  assertEquals(typeof result.onPlateau, "boolean");
  assertEquals(typeof result.improvementRate, "number");
  assertEquals(detectPlateau.length, 3);

  const markdown = await Deno.readTextFile(EVOLUTION_DOC);
  const signature = markdown.match(/detectPlateau\(([^)]*)\)/)?.[1];
  assert(signature !== undefined, "detectPlateau signature not documented");
  assertEquals(
    signature.split(",").length,
    detectPlateau.length,
    `documented detectPlateau takes ${
      signature.split(",").length
    } parameters, the function takes ${detectPlateau.length}: ${signature}`,
  );
});

/** GitHub's heading slug: lowercase, drop punctuation, spaces to hyphens. */
function slugify(heading: string): string {
  return heading
    .toLowerCase()
    .replace(/[^\w\s-]/g, "")
    .trim()
    // GitHub maps each remaining space to a hyphen; it does not collapse runs.
    .replace(/ /g, "-");
}

Deno.test("docs/api: every in-repo CONFIGURATION.md anchor resolves to a heading", async () => {
  const config = await Deno.readTextFile(CONFIGURATION_DOC);
  const anchors = new Set(
    config.split("\n")
      .filter((l) => l.startsWith("#"))
      .map((l) => slugify(l.replace(/^#+\s*/, ""))),
  );

  const docs = [EVOLUTION_DOC, COMPUTE_DOC, INTEROP_DOC, COSTS_DOC];
  const contents = await Promise.all(docs.map((d) => Deno.readTextFile(d)));

  docs.forEach((doc, i) => {
    for (
      const [, anchor] of contents[i].matchAll(
        /CONFIGURATION\.md#([\w-]+)/g,
      )
    ) {
      assert(
        anchors.has(anchor),
        `${doc} links to CONFIGURATION.md#${anchor}, which has no matching heading`,
      );
    }
  });
});

Deno.test("CONFIGURATION: outputRanges section names the real option key", async () => {
  const markdown = await Deno.readTextFile(CONFIGURATION_DOC);
  assert(
    /^### `outputRanges`/m.test(markdown),
    "the section heading must use the real NeatOptions key `outputRanges`",
  );
  // The documented helper takes per-record output values, not a creature.
  const penalty = calculateOutputRangePenalty([2], [{
    min: 0,
    max: 1,
    penaltyWeight: 1,
  }]);
  assert(penalty > 0, "an out-of-range output must be penalised");
  assertEquals(calculateOutputRangePenalty.length, 2);
  const signature = markdown.match(/calculateOutputRangePenalty\(([^)]*)\)/)
    ?.[1];
  assert(signature !== undefined, "penalty helper signature not documented");
  assert(
    !/creature/i.test(signature),
    `the helper takes output values, not a creature: ${signature}`,
  );
});

Deno.test("CONFIGURATION: discoveryDiskSpace section names the real option key", async () => {
  const markdown = await Deno.readTextFile(CONFIGURATION_DOC);
  assert(
    /^### `discoveryDiskSpace`/m.test(markdown),
    "the section heading must use the real NeatOptions key `discoveryDiskSpace`",
  );
  assert(
    !/`diskSpace`/.test(markdown),
    "CONFIGURATION.md still refers to the non-existent `diskSpace` key",
  );
});
