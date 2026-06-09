/**
 * Guardrail test for Issue #2881.
 *
 * Every external dependency declared in `deno.json`'s `imports` map must
 * actually be imported by at least one source file. Declared-but-unimported
 * dependencies are dead weight: they are still fetched and cached, they
 * widen the supply-chain attack surface (every transitive of an unused dep
 * remains a risk per Issue #2184), and they mislead readers and audits
 * about what `@stsoftware/neat-ai` really consumes.
 *
 * This test fails the build if any `jsr:` / `npm:` / `https:` import-map
 * entry is never referenced by an `import` / dynamic-import under `src/`,
 * `test/`, `bench/`, `scripts/`, or `mod.ts`. It was introduced when
 * `@std/csv` and `@std/streams` were removed as dead dependencies.
 */

import { assert, assertEquals } from "@std/assert";
import { walk } from "@std/fs";
import { fromFileUrl, join } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const SELF_PATH = fromFileUrl(import.meta.url);

/** Source roots scanned for import references. */
const SCAN_ROOTS = ["src", "test", "bench", "scripts", "mod.ts"];

/**
 * An import-map entry is an *external dependency* (rather than an internal
 * path alias) when its value resolves to a registry/URL specifier.
 */
export function isExternalDependency(value: string): boolean {
  return /^(?:jsr:|npm:|https:)/.test(value);
}

/**
 * Extract the external-dependency specifiers (the import-map keys) from a
 * `deno.json` imports map. Internal path aliases (values starting with
 * `./`, or bare directory mappings) are excluded.
 */
export function externalDependencySpecifiers(
  imports: Record<string, string>,
): string[] {
  return Object.entries(imports)
    .filter(([, value]) => isExternalDependency(value))
    .map(([key]) => key);
}

/** Escape a string for safe interpolation into a RegExp. */
function escapeRegExp(literal: string): string {
  return literal.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/**
 * Build a specifier-anchored regex that matches a static or dynamic import
 * of `specifier`. Matches `import ... from "spec"`, `import "spec"`, and
 * `import("spec")`, with an optional `jsr:` prefix and a trailing boundary
 * so `@std/path` does not match `@std/pathx`.
 */
export function importSpecifierRegExp(specifier: string): RegExp {
  const escaped = escapeRegExp(specifier);
  return new RegExp(
    `(?:from|import)\\s*\\(?\\s*["']\\s*(?:jsr:)?${escaped}(?:["'/@]|$)`,
  );
}

/** Whether any of the supplied source texts imports `specifier`. */
export function isSpecifierImported(
  specifier: string,
  sources: string[],
): boolean {
  const re = importSpecifierRegExp(specifier);
  return sources.some((text) => re.test(text));
}

async function collectScanTargets(): Promise<string[]> {
  const stats = await Promise.all(
    SCAN_ROOTS.map(async (root) => {
      const fullPath = join(REPO_ROOT, root);
      try {
        return { fullPath, stat: await Deno.stat(fullPath) };
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

Deno.test("isExternalDependency distinguishes registry deps from path aliases", () => {
  assert(isExternalDependency("jsr:@std/path@1.1.5"));
  assert(isExternalDependency("npm:left-pad@1.3.0"));
  assert(isExternalDependency("https://deno.land/x/foo/mod.ts"));
  assert(!isExternalDependency("./src/architecture/"));
  assert(!isExternalDependency("./src/Creature.ts"));
});

Deno.test("externalDependencySpecifiers returns only registry keys", () => {
  const specs = externalDependencySpecifiers({
    "@std/path": "jsr:@std/path@1.1.5",
    "@stsoftware/tags": "jsr:@stsoftware/tags@1.0.13",
    "@architecture/": "./src/architecture/",
    "@creature": "./src/Creature.ts",
  });
  assertEquals(specs.sort(), ["@std/path", "@stsoftware/tags"]);
});

Deno.test("importSpecifierRegExp matches static, side-effect and dynamic imports", () => {
  const re = importSpecifierRegExp("@std/csv");
  assert(re.test('import { parse } from "@std/csv";'));
  assert(re.test('import { parse } from "jsr:@std/csv";'));
  assert(re.test('import "@std/csv";'));
  assert(re.test('const m = await import("@std/csv");'));
  assert(re.test('import { stringify } from "@std/csv/stringify";'));
});

Deno.test("importSpecifierRegExp respects specifier boundaries", () => {
  const re = importSpecifierRegExp("@std/path");
  assert(re.test('import { join } from "@std/path";'));
  // Must not match a longer, unrelated specifier.
  assert(!re.test('import { x } from "@std/pathx";'));
  // Must not match prose mentioning the package name.
  assert(!re.test("// see @std/path for join()"));
});

Deno.test("isSpecifierImported finds a used dependency and rejects an unused one", () => {
  const sources = [
    'import { join } from "@std/path";',
    "export const x = 1;",
  ];
  assert(isSpecifierImported("@std/path", sources));
  assert(!isSpecifierImported("@std/csv", sources));
});

Deno.test("every external deno.json dependency is imported by source", async () => {
  const denoJsonPath = join(REPO_ROOT, "deno.json");
  const config = JSON.parse(await Deno.readTextFile(denoJsonPath)) as {
    imports?: Record<string, string>;
  };
  const specifiers = externalDependencySpecifiers(config.imports ?? {});
  assert(specifiers.length > 0, "expected at least one external dependency");

  const targets = await collectScanTargets();
  const sources = await Promise.all(
    targets.map((absPath) => Deno.readTextFile(absPath)),
  );

  const unused = specifiers.filter((spec) =>
    !isSpecifierImported(spec, sources)
  );

  assertEquals(
    unused,
    [],
    "Unused external dependencies declared in deno.json (remove them or add " +
      `the import that consumes them): ${unused.join(", ")}`,
  );
});

Deno.test("deno.json no longer declares the removed @std/csv and @std/streams deps", async () => {
  const denoJsonPath = join(REPO_ROOT, "deno.json");
  const config = JSON.parse(await Deno.readTextFile(denoJsonPath)) as {
    imports?: Record<string, string>;
  };
  const imports = config.imports ?? {};
  assertEquals(imports["@std/csv"], undefined);
  assertEquals(imports["@std/streams"], undefined);
});
