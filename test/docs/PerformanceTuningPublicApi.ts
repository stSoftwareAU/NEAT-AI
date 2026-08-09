/**
 * Issue #3731 — fact-check guard for the docs/PERFORMANCE_TUNING.md examples.
 *
 * The Selection Pressure sample used to call
 * `new Neat(input, output, fitness, options)`: `Neat` is internal (not
 * re-exported from `mod.ts`) and its real signature is
 * `(input, output, options, workers, fastWorkers?)` — there is no `fitness`
 * parameter. That breaches `docs/DOC_STYLE.md` rule 4, which allows only
 * symbols re-exported from `mod.ts` in reader-facing examples.
 *
 * These are "what" tests: the first walks every constructor and root import in
 * the guide and asserts the symbol really is public (a general check, not a
 * grep for `Neat`); the second runs the corrected sample through the public
 * `Creature.evolveDataSet()` path and asserts it evolves.
 */

import { assert, assertEquals, assertGreater } from "@std/assert";
import { Creature, Selection } from "../../mod.ts";
import * as publicApi from "../../mod.ts";

/** Fenced TypeScript code blocks in a markdown doc, blockquote markers stripped. */
function tsCodeBlocks(markdown: string): string[] {
  const blockRe = /^>?\s*```(?:ts|typescript)\n([\s\S]*?)^>?\s*```/gm;
  return [...markdown.matchAll(blockRe)].map((match) =>
    match[1].replace(/^>\s?/gm, "")
  );
}

/** Class names constructed with `new X(...)` inside TypeScript examples. */
export function collectConstructedSymbols(markdown: string): string[] {
  const names: string[] = [];
  for (const block of tsCodeBlocks(markdown)) {
    for (const match of block.matchAll(/\bnew\s+([A-Za-z_$][\w$]*)\s*\(/g)) {
      names.push(match[1]);
    }
  }
  return names;
}

/** Named symbols imported from the package root inside TypeScript examples. */
export function collectRootImportedSymbols(markdown: string): string[] {
  const importRe =
    /import\s*\{([^}]*)\}\s*from\s*["']@stsoftware\/neat-ai["']/g;
  const symbols: string[] = [];
  for (const block of tsCodeBlocks(markdown)) {
    for (const match of block.matchAll(importRe)) {
      for (const clause of match[1].split(",")) {
        const trimmed = clause.trim();
        // Skip `import { type Foo }` — type-only symbols have no runtime binding.
        if (!trimmed || /^type\s/.test(trimmed)) continue;
        symbols.push(trimmed.split(/\s+as\s+/)[0].trim());
      }
    }
  }
  return symbols;
}

/** Built-ins that are legitimately constructed in examples but are not NEAT-AI symbols. */
const GLOBAL_CONSTRUCTORS = new Set([
  "Array",
  "Error",
  "Float32Array",
  "Map",
  "Set",
  "URL",
  "Worker",
]);

async function performanceTuningMarkdown(): Promise<string> {
  return await Deno.readTextFile(
    new URL("../../docs/PERFORMANCE_TUNING.md", import.meta.url),
  );
}

Deno.test("collectConstructedSymbols finds constructors only in TypeScript blocks", () => {
  const markdown = [
    "```ts\nconst c = new Creature(2, 1);\n```",
    "> ```typescript\n> const m = new Map();\n> ```",
    "```bash\nnew Nonsense()\n```",
    "Prose mentioning new Thing() outside a block.",
  ].join("\n\n");

  assertEquals(collectConstructedSymbols(markdown), ["Creature", "Map"]);
  assertEquals(collectConstructedSymbols("no code here"), []);
});

Deno.test("collectRootImportedSymbols extracts named symbols and skips type-only ones", () => {
  const markdown = [
    '```ts\nimport { Creature, Selection } from "@stsoftware/neat-ai";\n```',
    '> ```typescript\n> import { type NeatOptions, setDistanceCacheMaxSize } from "@stsoftware/neat-ai";\n> ```',
    '```ts\nimport { Foo } from "some-other-package";\n```',
  ].join("\n\n");

  assertEquals(collectRootImportedSymbols(markdown), [
    "Creature",
    "Selection",
    "setDistanceCacheMaxSize",
  ]);
});

Deno.test("PERFORMANCE_TUNING.md constructs only classes mod.ts re-exports", async () => {
  const markdown = await performanceTuningMarkdown();
  const constructed = collectConstructedSymbols(markdown).filter(
    (name) => !GLOBAL_CONSTRUCTORS.has(name),
  );
  assertGreater(
    constructed.length,
    0,
    "PERFORMANCE_TUNING.md should construct at least one NEAT-AI class",
  );

  const missing = [...new Set(constructed)].filter((name) =>
    !(name in publicApi)
  );
  assertEquals(
    missing,
    [],
    `PERFORMANCE_TUNING.md constructs symbols not re-exported from mod.ts: ${
      missing.join(", ")
    }`,
  );
});

Deno.test("PERFORMANCE_TUNING.md imports only symbols mod.ts re-exports", async () => {
  const markdown = await performanceTuningMarkdown();
  const symbols = collectRootImportedSymbols(markdown);
  assertGreater(
    symbols.length,
    0,
    "PERFORMANCE_TUNING.md should contain an import example",
  );

  const missing = [...new Set(symbols)].filter((name) => !(name in publicApi));
  assertEquals(
    missing,
    [],
    `PERFORMANCE_TUNING.md imports symbols not re-exported from mod.ts: ${
      missing.join(", ")
    }`,
  );
});

Deno.test("the documented selection-pressure options evolve through the public entry point", async () => {
  const dataSet = [
    { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
    { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
    { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
  ];

  // The sample exactly as PERFORMANCE_TUNING.md now shows it.
  const creature = new Creature(2, 1);
  const result = await creature.evolveDataSet(dataSet, {
    selection: Selection.POWER,
    selectionPressure: { power: 8 },
    iterations: 2,
    populationSize: 10,
    threads: 1,
  });

  assert(
    Number.isFinite(result.error),
    "evolving with the documented options should produce a finite error",
  );
});
