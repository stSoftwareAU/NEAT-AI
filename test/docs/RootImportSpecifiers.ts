/**
 * Issue #3281 — fact-check guard for the package's single public entry point.
 *
 * `deno.json` declares `"exports": "./mod.ts"` — a bare string, so the only
 * published specifier is the root `@stsoftware/neat-ai`. There is no
 * `/utils/Logger` or `/wasm` subpath. Docs that imported from those subpaths
 * threw a module-resolution error on the first copy-paste.
 *
 * These are "what" tests: the symbols the docs use are imported from the public
 * entry point (`mod.ts`) and invoked exactly as the corrected examples show,
 * proving the root specifier resolves. A companion guard scans the affected doc
 * files so the broken subpath specifiers cannot creep back in.
 */

import { assert, assertEquals } from "@std/assert";
import {
  getLogger,
  getMaxCachedWasmCreatureActivations,
  setLogger,
  setMaxCachedWasmCreatureActivations,
} from "../../mod.ts";

Deno.test("mod.ts re-exports setLogger (AGENTS.md logging example)", () => {
  const original = getLogger();
  try {
    const calls: string[] = [];
    setLogger({
      debug: () => calls.push("debug"),
      info: () => calls.push("info"),
      warn: () => calls.push("warn"),
      error: () => calls.push("error"),
    });
    getLogger().info("hello");
    assertEquals(calls, ["info"]);
  } finally {
    setLogger(original);
  }
});

Deno.test(
  "mod.ts re-exports setMaxCachedWasmCreatureActivations (troubleshooting example)",
  () => {
    const original = getMaxCachedWasmCreatureActivations();
    try {
      setMaxCachedWasmCreatureActivations(256);
      assertEquals(getMaxCachedWasmCreatureActivations(), 256);
    } finally {
      setMaxCachedWasmCreatureActivations(original);
    }
  },
);

Deno.test("docs import these symbols from the root specifier, not a subpath", async () => {
  // Files that previously imported from non-existent subpaths (#3281).
  const files = [
    "AGENTS.md",
    "docs/troubleshooting/MEMORY.md",
    "docs/troubleshooting/WASM.md",
  ];

  // Specifiers the package does not export — every copy-paste of these fails.
  const forbiddenSpecifiers = [
    "@stsoftware/neat-ai/utils/Logger",
    "neat-ai/wasm",
  ];

  const texts = await Promise.all(
    files.map((file) =>
      Deno.readTextFile(new URL(`../../${file}`, import.meta.url))
    ),
  );

  files.forEach((file, i) => {
    for (const specifier of forbiddenSpecifiers) {
      assert(
        !texts[i].includes(`from "${specifier}"`),
        `${file} still imports from the non-existent subpath "${specifier}"`,
      );
    }
  });
});
