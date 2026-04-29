/**
 * Guardrail test for Issue #2481.
 *
 * NEAT-AI deliberately does **not** depend on `@std/log` (it is marked
 * unstable on JSR; the project ships its own pluggable Logger in
 * `src/utils/Logger.ts`). This test fails the build if `@std/log` is
 * ever introduced as a direct dependency — either via `deno.json`'s
 * `imports` map or via an `import` statement anywhere under `src/`,
 * `test/`, or `mod.ts`.
 *
 * See AGENTS.md > Logging Policy for the rationale and consumer
 * extension points (`NeatOptions.logger`, `setLogger`).
 */

import { assertEquals, assertMatch, assertNotMatch } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, join, relative } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SELF_PATH = fromFileUrl(import.meta.url);

/**
 * Specifier-anchored regex matching banned `@std/log` imports.
 *
 * Matches both `import "..."` and `import ... from "..."` forms, with
 * an optional `jsr:` prefix. The `from`/`import` anchor prevents
 * false-positive substring matches against benign identifiers like
 * `getLogger`, `LogLevel`, `console.log`, or JSDoc prose containing
 * the string `@std/log`.
 */
export const BANNED_LOG_IMPORT_RE =
  /(?:from|import)\s+["']\s*(?:jsr:)?@std\/log(?:["'/@]|$)/;

/** Match deno.json import keys/values that resolve to `@std/log`. */
const BANNED_LOG_SPECIFIER_RE = /^(?:jsr:)?@std\/log(?:[/@"']|$)/;

/**
 * Scan source text for banned `@std/log` imports. Returns one entry
 * per matched line.
 */
export function findBannedLogImports(
  source: string,
): { line: number; text: string }[] {
  const offences: { line: number; text: string }[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (BANNED_LOG_IMPORT_RE.test(lines[i])) {
      offences.push({ line: i + 1, text: lines[i] });
    }
  }
  return offences;
}

Deno.test('BANNED_LOG_IMPORT_RE flags `from "@std/log"`', () => {
  // Built by concatenation so this fixture itself does not show up as a
  // banned import when the test file is scanned.
  const positive = 'import { getLogger } from "' + "@std" + '/log";';
  assertMatch(positive, BANNED_LOG_IMPORT_RE);
});

Deno.test('BANNED_LOG_IMPORT_RE flags `from "jsr:@std/log"`', () => {
  const positive = 'import { getLogger } from "jsr:' + "@std" + '/log";';
  assertMatch(positive, BANNED_LOG_IMPORT_RE);
});

Deno.test("BANNED_LOG_IMPORT_RE flags submodule imports", () => {
  const positive = 'import { LevelName } from "' + "@std" + '/log/levels";';
  assertMatch(positive, BANNED_LOG_IMPORT_RE);
});

Deno.test("BANNED_LOG_IMPORT_RE flags side-effect imports", () => {
  const positive = 'import "' + "@std" + '/log";';
  assertMatch(positive, BANNED_LOG_IMPORT_RE);
});

Deno.test("BANNED_LOG_IMPORT_RE does not false-positive on benign 'log' usages", () => {
  const benign = [
    // Local Logger import — different module path entirely.
    'import { getLogger } from "@utils/Logger.ts";',
    // Identifier that happens to contain "Log".
    'const level: LogLevel = "info";',
    // String literal logged to the console — no `from`/`import` anchor.
    'console.log("@std/log");',
    // Hyperlink-style mention in a comment.
    "// see jsr.io/@std/log for the unstable marker",
    // JSDoc paragraph mentioning the package by name.
    "/** Reference: @std/log is unstable, do not use. */",
    // Hypothetical sibling package — must not be flagged by the boundary.
    'import { foo } from "@std/logger-shim";',
  ];
  for (const line of benign) {
    assertNotMatch(line, BANNED_LOG_IMPORT_RE);
  }
});

Deno.test("findBannedLogImports reports line numbers for offending sources", () => {
  const source = [
    "// header",
    'import { x } from "@utils/Logger.ts";',
    "",
    'import { getLogger } from "' + "@std" + '/log";',
    "console.log('done');",
  ].join("\n");

  const hits = findBannedLogImports(source);
  assertEquals(hits.length, 1);
  assertEquals(hits[0].line, 4);
});

Deno.test("deno.json imports do not include @std/log", async () => {
  const denoJsonPath = join(REPO_ROOT, "deno.json");
  const config = JSON.parse(await Deno.readTextFile(denoJsonPath)) as {
    imports?: Record<string, string>;
  };
  const imports = config.imports ?? {};
  const offences: string[] = [];
  for (const [key, value] of Object.entries(imports)) {
    if (BANNED_LOG_SPECIFIER_RE.test(key)) {
      offences.push(`key "${key}"`);
    }
    if (BANNED_LOG_SPECIFIER_RE.test(String(value))) {
      offences.push(`value "${value}" (key "${key}")`);
    }
  }
  assertEquals(
    offences,
    [],
    `deno.json imports must not reference @std/log: ${offences.join(", ")}`,
  );
});

async function collectScanTargets(): Promise<string[]> {
  const roots = ["src", "test", "mod.ts"];
  const stats = await Promise.all(
    roots.map(async (root) => {
      const fullPath = join(REPO_ROOT, root);
      try {
        const stat = await Deno.stat(fullPath);
        return { fullPath, stat };
      } catch {
        return null;
      }
    }),
  );

  const fileLists = await Promise.all(
    stats.map(async (entry) => {
      if (entry === null) return [];
      if (entry.stat.isFile) return [entry.fullPath];
      const paths: string[] = [];
      for await (
        const walked of walk(entry.fullPath, {
          exts: [".ts"],
          includeDirs: false,
          followSymlinks: false,
        })
      ) {
        paths.push(walked.path);
      }
      return paths;
    }),
  );

  return fileLists.flat().filter((path) => path !== SELF_PATH);
}

Deno.test("no source file imports @std/log", async () => {
  const targets = await collectScanTargets();

  const perFile = await Promise.all(
    targets.map(async (absPath) => {
      const text = await Deno.readTextFile(absPath);
      return findBannedLogImports(text).map((hit) => ({
        file: relative(REPO_ROOT, absPath),
        line: hit.line,
        text: hit.text,
      }));
    }),
  );

  const offences = perFile.flat();

  assertEquals(
    offences,
    [],
    "Forbidden @std/log imports found:\n" +
      offences
        .map((o) => `  ${o.file}:${o.line}: ${o.text.trim()}`)
        .join("\n"),
  );
});
