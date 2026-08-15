/**
 * Issue #3583 — diagnostic dumps must be redirectable to a per-spec directory
 * so specs sharing a dump file-name prefix cannot read each other's dumps when
 * run in parallel.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import {
  DIAGNOSTICS_DIR,
  getDiagnosticsDir,
  setDiagnosticsDir,
  writeDiagnostics,
} from "@utils/Diagnostics.ts";

function listing(dir: string): string[] {
  try {
    return Array.from(Deno.readDirSync(dir)).map((entry) => entry.name);
  } catch {
    return [];
  }
}

Deno.test("Issue #3583: writeDiagnostics honours the configured directory", () => {
  const dir = Deno.makeTempDirSync({ prefix: "neat-diagnostics-unit-" });
  setDiagnosticsDir(dir);
  try {
    assertEquals(getDiagnosticsDir(), dir);

    writeDiagnostics({
      error: new Error("redirected"),
      prefix: "issue-3583-shared-prefix",
      context: { marker: "mine" },
    });

    const names = listing(dir);
    const errorFile = names.find((n) =>
      n.startsWith("issue-3583-shared-prefix-error-")
    );
    const contextFile = names.find((n) =>
      n.startsWith("issue-3583-shared-prefix-context-")
    );
    assert(errorFile, `expected an error dump in ${dir}, got: ${names}`);
    assert(contextFile, `expected a context dump in ${dir}, got: ${names}`);

    const context = JSON.parse(
      Deno.readTextFileSync(`${dir}/${contextFile}`),
    );
    assertEquals(context.marker, "mine");

    // Do not list the default directory — leftover dumps can number in the
    // hundreds of thousands and hang this spec. Stat the names we just wrote.
    for (const name of names) {
      try {
        Deno.statSync(`${DIAGNOSTICS_DIR}/${name}`);
        throw new Error(
          `dump ${name} landed in the default directory while redirected`,
        );
      } catch (error) {
        if (!(error instanceof Deno.errors.NotFound)) {
          throw error;
        }
      }
    }
  } finally {
    setDiagnosticsDir();
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("Issue #3583: setDiagnosticsDir with no argument restores the default", () => {
  const dir = Deno.makeTempDirSync({ prefix: "neat-diagnostics-unit-" });
  try {
    setDiagnosticsDir(dir);
    setDiagnosticsDir();
    assertEquals(getDiagnosticsDir(), DIAGNOSTICS_DIR);
  } finally {
    setDiagnosticsDir();
    Deno.removeSync(dir, { recursive: true });
  }
});

Deno.test("Issue #3583: setDiagnosticsDir rejects a blank directory", () => {
  assertThrows(
    () => setDiagnosticsDir("   "),
    Error,
    "non-empty",
  );
  assertEquals(
    getDiagnosticsDir(),
    DIAGNOSTICS_DIR,
    "a rejected directory must not change the active directory",
  );
});
