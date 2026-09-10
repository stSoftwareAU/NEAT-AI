/**
 * Unit tests for the Issue #3974 matched-baseline harness.
 *
 * The harness's own summarising is what the committed evidence is read from,
 * so it is tested like any other code: real inputs, asserted outputs.
 */
import {
  assert,
  assertAlmostEquals,
  assertEquals,
  assertThrows,
} from "@std/assert";
import { Creature } from "@creature";
import {
  assertValidSquashBiasConfig,
  CEILING_SQUASH,
  histogramEntropyBits,
  measureRoleVisibility,
  renderRoleVisibility,
  SQUASH_BIAS_DEFAULTS,
  withSquashBiasDefaults,
} from "./deep_chain_squash_bias.ts";
import { gradientDeadFraction } from "@methods/activations/GradientBlocking.ts";

Deno.test("squash-bias harness - entropy falls as the mix collapses", () => {
  assertEquals(histogramEntropyBits({}), 0);
  assertEquals(histogramEntropyBits({ TANH: 10 }), 0);
  assertAlmostEquals(histogramEntropyBits({ TANH: 5, ReLU: 5 }), 1, 1e-9);
  assert(
    histogramEntropyBits({ TANH: 9, ReLU: 1 }) <
      histogramEntropyBits({ TANH: 5, ReLU: 5 }),
    "a lopsided mix carries less entropy than an even one",
  );
});

Deno.test("squash-bias harness - the ceiling squash is free of dead derivative", () => {
  // The arm bounds what any squash choice could achieve, so its own squash
  // must never be the fault it excludes. `TANH` would be: its derivative
  // underflows to exactly zero past |x| ~ 20, which the run's fan-in of 1,265
  // reaches easily.
  assertEquals(
    gradientDeadFraction(CEILING_SQUASH),
    0,
    `${CEILING_SQUASH} must have no exactly-zero derivative on the grid`,
  );
});

Deno.test("squash-bias harness - the config refuses a meaningless comparison", () => {
  assertEquals(withSquashBiasDefaults({}), SQUASH_BIAS_DEFAULTS);
  assertThrows(
    () => assertValidSquashBiasConfig({ ...SQUASH_BIAS_DEFAULTS, bias: 0 }),
    RangeError,
    "bias",
  );
  assertThrows(
    () =>
      assertValidSquashBiasConfig({ ...SQUASH_BIAS_DEFAULTS, minLength: 1 }),
    RangeError,
    "minLength",
  );
  assertThrows(
    () =>
      assertValidSquashBiasConfig({ ...SQUASH_BIAS_DEFAULTS, mutations: 0 }),
    RangeError,
    "mutations",
  );
});

Deno.test("squash-bias harness - role visibility counts the run against its roles", () => {
  // input-0 → a → b → c → d → output, with a second input at `a`: a five-deep
  // run whose members share their roles with the two wide neurons beside it.
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "a", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "b", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "c", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "a", weight: 1 },
      { fromUUID: "input-1", toUUID: "a", weight: 1 },
      { fromUUID: "a", toUUID: "b", weight: 1 },
      { fromUUID: "b", toUUID: "c", weight: 1 },
      { fromUUID: "c", toUUID: "output-0", weight: 1 },
    ],
  });

  const rows = measureRoleVisibility(creature);
  assert(rows.length > 0, "the run touches at least one role");
  const total = rows.reduce((sum, row) => sum + row.runMembers, 0);
  assertEquals(total, 4, "every member of the four-member run is counted");
  for (const row of rows) {
    assert(
      row.neurons >= row.runMembers,
      "a role cannot hold fewer neurons than it holds run members",
    );
  }

  const rendered = renderRoleVisibility("fixture", rows);
  assert(rendered.includes("| Role |"), "renders a table");
  assert(
    !/\|\s*mid\|/.test(rendered),
    "the pipe inside a role key is escaped so the table survives",
  );
});

Deno.test("squash-bias harness - every pipe in a role key is escaped", () => {
  // Regression for the incomplete-sanitization finding (PR #3994): a
  // single-occurrence `replace` escaped only the first pipe, so any extra
  // pipe still ended the Markdown cell.
  const rendered = renderRoleVisibility("fixture", [
    { role: "deep|high|extra", neurons: 2, runMembers: 1 },
  ]);
  const cells = rendered.split("\n").at(-2)?.split(/(?<!\\)\|/) ?? [];
  assertEquals(
    cells.length,
    6,
    `the role occupies exactly one cell, got: ${JSON.stringify(cells)}`,
  );
  assert(
    rendered.includes("deep\\|high\\|extra"),
    "every pipe in the role key is escaped",
  );
});
