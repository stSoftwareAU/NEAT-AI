/**
 * @module
 *
 * Replays the language-neutral `creatureValidate` conformance corpus
 * (Issue #3801).
 *
 * Every case under `test/fixtures/validate/` is plain JSON loaded with
 * `JSON.parse` — no TypeScript constructs, no `$ref`, no code-built creatures —
 * so NEAT-AI-core can vendor the same bytes as a Rust test input while this
 * runner freezes the current TypeScript behaviour. `coverage.json` beside the
 * fixtures maps each throw site in `src/architecture/CreatureValidate.ts` to
 * the cases that pin it; a site losing its last case fails the coverage gate
 * rather than silently going untested.
 */

import { assert, assertEquals, fail } from "@std/assert";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { TopologyError } from "@errors/TopologyError.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import {
  type CorpusCase,
  type CorpusFile,
  parseCorpusFile,
} from "./conformance/ConformanceCase.ts";
import { buildConformanceCreature } from "./conformance/ConformanceCreature.ts";
import {
  type CoverageManifest,
  parseCoverageManifest,
} from "./conformance/ConformanceCoverage.ts";

const CORPUS_DIR = new URL("../fixtures/validate/", import.meta.url);
const COVERAGE_FILE = "coverage.json";

/** Loads every corpus file, sorted so test order is deterministic. */
function loadCorpus(): { file: string; corpus: CorpusFile }[] {
  const names: string[] = [];
  for (const entry of Deno.readDirSync(CORPUS_DIR)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    if (entry.name === COVERAGE_FILE) continue;
    names.push(entry.name);
  }
  assert(names.length > 0, `No corpus files found in ${CORPUS_DIR}`);
  names.sort();
  return names.map((file) => ({
    file,
    corpus: parseCorpusFile(
      Deno.readTextFileSync(new URL(file, CORPUS_DIR)),
      file,
    ),
  }));
}

function loadCoverage(): CoverageManifest {
  return parseCoverageManifest(
    Deno.readTextFileSync(new URL(COVERAGE_FILE, CORPUS_DIR)),
    COVERAGE_FILE,
  );
}

/** Replays one case against the current implementation. */
function replay(testCase: CorpusCase): void {
  const creature = buildConformanceCreature(testCase.creature);
  const { expect } = testCase;

  if (expect.outcome === "ok") {
    const stats = creatureValidate(creature, testCase.options);
    assertEquals(stats, expect.stats, `stats mismatch for '${testCase.name}'`);
    return;
  }

  try {
    creatureValidate(creature, testCase.options);
  } catch (caught) {
    const error = caught as ValidationError | TopologyError;
    const expectedClass = expect.error === "ValidationError"
      ? ValidationError
      : TopologyError;
    assert(
      error instanceof expectedClass,
      `'${testCase.name}' expected ${expect.error}, got ${
        (caught as Error)?.name
      }: ${(caught as Error)?.message}`,
    );
    assertEquals(
      error.reason,
      expect.reason,
      `'${testCase.name}' reason mismatch (message: ${error.message})`,
    );
    assert(
      error.message.includes(expect.messageContains as string),
      `'${testCase.name}' message '${error.message}' does not contain '${expect.messageContains}'`,
    );
    return;
  }
  fail(`'${testCase.name}' expected ${expect.error} but validation passed`);
}

const CORPUS = loadCorpus();

for (const { file, corpus } of CORPUS) {
  for (const testCase of corpus.cases) {
    Deno.test(
      `conformance ${corpus.group}: ${testCase.name} (${file})`,
      () => replay(testCase),
    );
  }
}

Deno.test("conformance corpus: case names are unique", () => {
  const seen = new Map<string, string>();
  for (const { file, corpus } of CORPUS) {
    for (const testCase of corpus.cases) {
      const previous = seen.get(testCase.name);
      assertEquals(
        previous,
        undefined,
        `case '${testCase.name}' appears in both ${previous} and ${file}`,
      );
      seen.set(testCase.name, file);
    }
  }
});

Deno.test("conformance corpus: every throw site is accounted for", () => {
  const manifest = loadCoverage();
  const byRule = new Map<string, CorpusCase[]>();
  for (const { corpus } of CORPUS) {
    for (const testCase of corpus.cases) {
      const list = byRule.get(testCase.rule) ?? [];
      list.push(testCase);
      byRule.set(testCase.rule, list);
    }
  }

  const declared = new Set(manifest.sites.map((site) => site.id));
  for (const rule of byRule.keys()) {
    assert(
      declared.has(rule),
      `case rule '${rule}' is not declared in ${COVERAGE_FILE}`,
    );
  }

  for (const site of manifest.sites) {
    const cases = byRule.get(site.id) ?? [];
    if (site.status === "not-expressible") {
      assertEquals(
        cases.length,
        0,
        `site '${site.id}' is marked not-expressible but has cases`,
      );
      continue;
    }
    assert(
      cases.length > 0,
      `site '${site.id}' (${site.status}) has no corpus case`,
    );
    if (site.status !== "covered") continue;
    for (const testCase of cases) {
      assertEquals(
        testCase.expect.outcome,
        site.kind === "throw" ? "throws" : "ok",
        `case '${testCase.name}' outcome disagrees with site '${site.id}'`,
      );
      if (site.kind !== "throw") continue;
      assertEquals(
        [testCase.expect.error, testCase.expect.reason],
        [site.error, site.reason],
        `case '${testCase.name}' error/reason disagrees with site '${site.id}'`,
      );
    }
  }
});
