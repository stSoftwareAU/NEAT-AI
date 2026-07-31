/**
 * Issue #3458 — the dependency-bump automation, its contributor docs and its
 * tests must stay self-contained for public readers.
 *
 * `bump-deps.sh` ships in every public clone and printed two private
 * issue-tracker slugs to stderr at runtime, so a public user running the script
 * was pointed at issues they cannot open. The behaviour being described — the
 * automated dependency-bump worker reverting a bump when an audit gate fails —
 * is fully expressible at concept level.
 *
 * This guard reads the real committed files, and runs the script's failure path
 * so the runtime message is checked too. Detection lives in
 * `test/_privateRepoRefs.ts` and is unit-tested by
 * `test/docs/PrivateRepoRefScanner.ts` (Issue #3604).
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";
import {
  findPrivateRepoRefs,
  scanForPrivateRepoRefs,
} from "../_privateRepoRefs.ts";

/** Files named in the #3458 private-repo-reference audit. */
const AUDITED_FILES = [
  "../../bump-deps.sh",
  "../../AGENTS.md",
  "./BumpDepsScript.ts",
];

for (const rel of AUDITED_FILES) {
  Deno.test(`${rel} has no private repo reference (#3458)`, () => {
    const path = fromFileUrl(new URL(rel, import.meta.url));
    const offenders = scanForPrivateRepoRefs([path]);
    assertEquals(
      offenders,
      [],
      `${rel} references a private stSoftwareAU repository (${
        offenders.join("")
      }). Reword to concept level so the file stays usable by public readers.`,
    );
  });
}

Deno.test("bump-deps.sh revert guidance stays concept level (#3458)", async () => {
  const path = fromFileUrl(new URL("../../bump-deps.sh", import.meta.url));
  const source = await Deno.readTextFile(path);
  const revertLines = source
    .split("\n")
    .filter((line) => line.includes("should revert"));
  assertEquals(
    revertLines.length,
    2,
    "expected both audit-gate failure paths to print revert guidance",
  );
  for (const line of revertLines) {
    assert(
      line.includes("Worker should revert this bump."),
      `runtime revert guidance must be self-contained, got: ${line.trim()}`,
    );
  }
});

/**
 * Run `bump-deps.sh` with a stub `deno` that fails the WASM smoke gate, so the
 * script takes its audit-gate failure path and prints the revert advice.
 *
 * @returns the script's stderr and exit code
 */
async function runFailingSmokeGate(): Promise<{
  stderr: string;
  code: number;
}> {
  const home = await Deno.makeTempDir();
  try {
    const binDir = `${home}/bin`;
    await Deno.mkdir(binDir, { recursive: true });
    const stub = `${binDir}/deno`;
    // `deno eval` (neatCore.rev read) succeeds; `deno test` (smoke gate) fails.
    await Deno.writeTextFile(
      stub,
      '#!/bin/sh\ncase "$1" in\n  test) exit 1 ;;\n  *) exit 0 ;;\nesac\n',
    );
    await Deno.chmod(stub, 0o755);

    const command = new Deno.Command("bash", {
      args: ["./bump-deps.sh", "--no-internal", "--no-external"],
      stdout: "piped",
      stderr: "piped",
      cwd: Deno.cwd(),
      env: { PATH: `${binDir}:/usr/bin:/bin`, HOME: home },
    });
    const output = await command.output();
    return {
      stderr: new TextDecoder().decode(output.stderr),
      code: output.code,
    };
  } finally {
    await Deno.remove(home, { recursive: true });
  }
}

Deno.test({
  name:
    "bump-deps.sh smoke-gate failure advises a revert without a private-repo slug (#3458)",
  fn: async () => {
    const result = await runFailingSmokeGate();
    assertEquals(result.code, 1, `expected exit 1; stderr=${result.stderr}`);
    assert(
      result.stderr.includes("Worker should revert this bump."),
      `expected concept-level revert advice; stderr=${result.stderr}`,
    );
    assertEquals(
      findPrivateRepoRefs(result.stderr),
      [],
      `runtime output must not name the private orchestration repo; ` +
        `stderr=${result.stderr}`,
    );
  },
});
