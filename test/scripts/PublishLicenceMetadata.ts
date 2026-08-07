import { assert, assertEquals } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * Issue #3674 — the published `@stsoftware/neat-ai` artefact must carry its
 * licence explicitly rather than by whatever `deno publish` auto-includes.
 *
 * Apache-2.0 §4.1 requires redistributions to carry a copy of the licence, and
 * SBOM / licence-compliance tooling reads the manifest's SPDX identifier first.
 * These are "what" tests: they assert on the manifest's declared licence
 * metadata and on the file set `deno publish` actually produces.
 */

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const DENO_JSON = join(REPO_ROOT, "deno.json");
const LICENCE_FILE = join(REPO_ROOT, "LICENSE");

Deno.test("deno.json declares the Apache-2.0 SPDX identifier (Issue #3674)", async () => {
  const json = JSON.parse(await Deno.readTextFile(DENO_JSON));
  assertEquals(
    json.license,
    "Apache-2.0",
    'deno.json must declare "license": "Apache-2.0" — consumers and SBOM ' +
      "tooling read the manifest's SPDX identifier first",
  );
});

Deno.test("the declared SPDX identifier matches the LICENSE file (Issue #3674)", async () => {
  const licence = await Deno.readTextFile(LICENCE_FILE);
  assert(
    licence.includes("Apache License") && licence.includes("Version 2.0"),
    "LICENSE at the repository root must be the Apache Licence 2.0 text so " +
      "the declared SPDX identifier is truthful",
  );
});

Deno.test("publish.include lists LICENSE explicitly (Issue #3674)", async () => {
  const json = JSON.parse(await Deno.readTextFile(DENO_JSON));
  const include: string[] = json.publish?.include ?? [];
  assert(
    include.includes("LICENSE"),
    "deno.json publish.include is an explicit allowlist, so LICENSE must be " +
      `listed in it — found: ${JSON.stringify(include)}`,
  );
});

Deno.test({
  name: "deno publish ships the LICENSE file (Issue #3674)",
  permissions: { run: true, read: true },
  fn: async () => {
    const command = new Deno.Command("deno", {
      args: ["publish", "--dry-run", "--allow-dirty"],
      stdout: "piped",
      stderr: "piped",
      cwd: REPO_ROOT,
    });
    const output = await command.output();
    const combined = new TextDecoder().decode(output.stdout) +
      new TextDecoder().decode(output.stderr);

    assert(
      /\/LICENSE\b/.test(combined),
      "deno publish must include LICENSE — Apache-2.0 §4.1 requires " +
        "redistributions to carry a copy of the licence",
    );
  },
});
