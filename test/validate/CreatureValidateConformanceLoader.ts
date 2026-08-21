/**
 * @module
 *
 * The conformance corpus is only worth having if a malformed case fails loudly
 * instead of being skipped (Issue #3801). These tests drive the corpus and
 * coverage parsers with deliberately broken input and assert they throw.
 */

import { assertEquals, assertThrows } from "@std/assert";
import { parseCorpusFile } from "./conformance/ConformanceCase.ts";
import { parseCoverageManifest } from "./conformance/ConformanceCoverage.ts";
import { buildConformanceCreature } from "./conformance/ConformanceCreature.ts";

const VALID_CASE = {
  name: "ok-minimal",
  rule: "OK_MINIMAL",
  creature: {
    input: 1,
    output: 1,
    neurons: [
      { type: "input", id: 0 },
      {
        type: "output",
        id: -1,
        uuid: "output-0",
        bias: 0,
        squash: "IDENTITY",
      },
    ],
    synapses: [{ from: 0, to: 1, weight: 1 }],
  },
  expect: {
    outcome: "ok",
    stats: { input: 1, constant: 0, hidden: 0, output: 1, connections: 1 },
  },
};

/** A corpus file carrying `VALID_CASE` with `patch` merged over the case. */
function corpusText(patch: Record<string, unknown> = {}): string {
  return JSON.stringify({
    group: "unit",
    cases: [{ ...VALID_CASE, ...patch }],
  });
}

Deno.test("corpus parser accepts a well-formed file", () => {
  const corpus = parseCorpusFile(corpusText(), "unit.json");
  assertEquals(corpus.group, "unit");
  assertEquals(corpus.cases.length, 1);
  assertEquals(corpus.cases[0].creature.neurons[1].bias, 0);
});

Deno.test("corpus parser rejects invalid JSON", () => {
  assertThrows(
    () => parseCorpusFile("{not json", "unit.json"),
    Error,
    "is not valid JSON",
  );
});

Deno.test("corpus parser rejects an unknown key", () => {
  assertThrows(
    () => parseCorpusFile(corpusText({ expectation: "ok" }), "unit.json"),
    Error,
    "unknown key 'expectation'",
  );
});

Deno.test("corpus parser rejects a neuron without an id key", () => {
  const text = JSON.stringify({
    group: "unit",
    cases: [{
      ...VALID_CASE,
      creature: { ...VALID_CASE.creature, neurons: [{ type: "input" }] },
    }],
  });
  assertThrows(
    () => parseCorpusFile(text, "unit.json"),
    Error,
    "'id' is required",
  );
});

Deno.test("corpus parser rejects a non-finite bias that is not a sentinel", () => {
  const text = JSON.stringify({
    group: "unit",
    cases: [{
      ...VALID_CASE,
      creature: {
        ...VALID_CASE.creature,
        neurons: [{ type: "hidden", id: 1, bias: "huge" }],
      },
    }],
  });
  assertThrows(
    () => parseCorpusFile(text, "unit.json"),
    Error,
    "'bias' must be a number",
  );
});

Deno.test("corpus parser rejects a throwing case with no reason", () => {
  assertThrows(
    () =>
      parseCorpusFile(
        corpusText({
          expect: { outcome: "throws", error: "ValidationError" },
        }),
        "unit.json",
      ),
    Error,
    "'reason' must be a non-empty string",
  );
});

Deno.test("corpus parser rejects an ok case with no stats", () => {
  assertThrows(
    () =>
      parseCorpusFile(corpusText({ expect: { outcome: "ok" } }), "unit.json"),
    Error,
    "outcome 'ok' requires 'stats'",
  );
});

Deno.test("corpus parser rejects a file with no cases", () => {
  assertThrows(
    () =>
      parseCorpusFile(JSON.stringify({ group: "unit", cases: [] }), "u.json"),
    Error,
    "contains no cases",
  );
});

Deno.test("coverage parser rejects a shadowed site with no note", () => {
  const text = JSON.stringify({
    sites: [{ id: "WASM_CYCLE", kind: "throw", status: "shadowed" }],
  });
  assertThrows(
    () => parseCoverageManifest(text, "coverage.json"),
    Error,
    "requires a 'note'",
  );
});

Deno.test("coverage parser rejects a duplicate site id", () => {
  const site = {
    id: "HIDDEN_NO_INWARD",
    kind: "throw",
    status: "covered",
    error: "ValidationError",
    reason: "NO_INWARD_CONNECTIONS",
  };
  assertThrows(
    () =>
      parseCoverageManifest(JSON.stringify({ sites: [site, site] }), "c.json"),
    Error,
    "duplicate site 'HIDDEN_NO_INWARD'",
  );
});

Deno.test("coverage parser rejects a covered throw site with no error class", () => {
  const text = JSON.stringify({
    sites: [{ id: "HIDDEN_NO_INWARD", kind: "throw", status: "covered" }],
  });
  assertThrows(
    () => parseCoverageManifest(text, "coverage.json"),
    Error,
    "must declare its 'error'",
  );
});

Deno.test("builder maps null to an absent value and sentinels to non-finite numbers", () => {
  const creature = buildConformanceCreature({
    input: 1,
    output: 1,
    neurons: [
      { type: "input", id: 0 },
      { type: "hidden", id: null, bias: null },
      { type: "output", id: -1, bias: "-Infinity", squash: "IDENTITY" },
    ],
    synapses: [{ from: 0, to: 1, weight: 1 }],
  });
  assertEquals(creature.neurons[0].bias, Infinity);
  assertEquals(creature.neurons[1].id, undefined as unknown as number);
  assertEquals(creature.neurons[1].bias, undefined as unknown as number);
  assertEquals(creature.neurons[2].bias, -Infinity);
  assertEquals(creature.neurons[2].index, 2);
});
