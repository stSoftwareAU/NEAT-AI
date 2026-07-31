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
  const before = listing(DIAGNOSTICS_DIR);
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

    // Nothing from this spec may reach the default directory — that is what
    // stops a parallel spec resolving this dump by its shared prefix. Only our
    // own prefix is checked; other specs legitimately write there in parallel.
    assertEquals(
      listing(DIAGNOSTICS_DIR)
        .filter((n) => !before.includes(n))
        .filter((n) => n.startsWith("issue-3583-shared-prefix-")),
      [],
      "no dump may land in the default directory while redirected",
    );
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
