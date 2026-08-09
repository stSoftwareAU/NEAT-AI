/**
 * Issue #3697 — fact-check guard for the AGENTS.md Logging Policy example.
 *
 * The sample used to `import { Neat, … } from "@stsoftware/neat-ai"` and call a
 * `new Neat(input, output, fitness, options)` constructor that never existed:
 * `Neat` is internal (not re-exported from `mod.ts`) and its real signature is
 * `(input, output, options, workers)`. Both breaches sit directly above the note
 * that forbids them, so the doc contradicted itself.
 *
 * These are "what" tests: the first walks every `@stsoftware/neat-ai` import in
 * AGENTS.md and asserts each named value symbol really is exported from the
 * public entry point (a general check, not a grep for `Neat`); the second runs
 * the corrected Option A through the public `Creature.evolveDataSet()` path and
 * asserts the injected logger actually receives the log output.
 */

import { assert, assertEquals, assertGreater } from "@std/assert";
import { Creature, getLogger, type Logger, setLogger } from "../../mod.ts";
import * as publicApi from "../../mod.ts";

/** Named symbols imported from the package root in a markdown doc. */
export function collectRootImportedSymbols(markdown: string): string[] {
  const importRe =
    /import\s*\{([^}]*)\}\s*from\s*["']@stsoftware\/neat-ai["']/g;
  const symbols: string[] = [];
  for (const match of markdown.matchAll(importRe)) {
    for (const clause of match[1].split(",")) {
      const name = clause.trim().replace(/^type\s+/, "").split(/\s+as\s+/)[0]
        .trim();
      // Skip `import { type Foo }` — type-only symbols have no runtime binding.
      if (name && !/^type\s/.test(clause.trim())) symbols.push(name);
    }
  }
  return symbols;
}

Deno.test("collectRootImportedSymbols extracts named symbols and skips type-only ones", () => {
  const markdown = [
    '```ts\nimport { Creature, setLogger } from "@stsoftware/neat-ai";\n```',
    '```ts\nimport { type Logger, getLogger } from "@stsoftware/neat-ai";\n```',
    '```ts\nimport { Foo } from "some-other-package";\n```',
  ].join("\n");

  assertEquals(collectRootImportedSymbols(markdown), [
    "Creature",
    "setLogger",
    "getLogger",
  ]);
});

Deno.test("AGENTS.md imports only symbols mod.ts actually re-exports", async () => {
  const markdown = await Deno.readTextFile(
    new URL("../../AGENTS.md", import.meta.url),
  );
  const symbols = collectRootImportedSymbols(markdown);
  assertGreater(
    symbols.length,
    0,
    "AGENTS.md should contain an import example",
  );

  const missing = symbols.filter((name) => !(name in publicApi));
  assertEquals(
    missing,
    [],
    `AGENTS.md imports symbols not re-exported from mod.ts: ${
      missing.join(", ")
    }`,
  );
});

Deno.test("NeatOptions.logger routes NEAT-AI log output to the injected logger", async () => {
  const original = getLogger();
  try {
    const calls: string[] = [];
    const myLogger: Logger = {
      debug: (...a: unknown[]) => calls.push(`debug:${a.length}`),
      info: (...a: unknown[]) => calls.push(`info:${a.length}`),
      warn: (...a: unknown[]) => calls.push(`warn:${a.length}`),
      error: (...a: unknown[]) => calls.push(`error:${a.length}`),
    };

    const trainingSet = [
      { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
      { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
      { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
      { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
    ];

    // Option A exactly as AGENTS.md now shows it.
    const creature = new Creature(2, 1);
    await creature.evolveDataSet(trainingSet, {
      logger: myLogger,
      iterations: 2,
      populationSize: 10,
      threads: 1,
    });

    assert(
      getLogger() === myLogger,
      "options.logger should become the active logger",
    );
    assertGreater(
      calls.length,
      0,
      "the injected logger should receive NEAT-AI log output",
    );
  } finally {
    setLogger(original);
  }
});
