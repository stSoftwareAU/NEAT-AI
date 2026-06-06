import { assert } from "@std/assert";
import { fromFileUrl, join } from "@std/path";

/**
 * Issue #2865 — SCR-LOCKFILE: supply-chain integrity pinning.
 *
 * This repo exact-pins its *direct* dependencies in deno.json's `imports`
 * map, but without a committed deno.lock the *transitive* dependency graph
 * is unpinned and no integrity hashes are recorded. A new — potentially
 * malicious — patch/minor version within an allowed transitive range could
 * be pulled into a build even though nothing in deno.json changed.
 *
 * A committed deno.lock closes that gap: it records the exact resolved
 * version *and* an integrity hash for every dependency in the tree, so Deno
 * verifies the resolved graph on every cache/install/run.
 *
 * These are "what" tests: they parse the committed deno.json / deno.lock and
 * assert on the resulting integrity-pinning posture, not on how each value
 * happens to be written.
 */

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));
const DENO_JSON = join(REPO_ROOT, "deno.json");
const DENO_LOCK = join(REPO_ROOT, "deno.lock");

Deno.test("deno.json does not disable the lockfile (Issue #2865)", async () => {
  const json = JSON.parse(await Deno.readTextFile(DENO_JSON));
  assert(
    json.lock !== false,
    'deno.json must not set "lock": false — disabling the lockfile turns off ' +
      "transitive-dependency integrity verification across local dev and CI",
  );
});

Deno.test("a committed deno.lock exists at the repo root (Issue #2865)", async () => {
  const info = await Deno.stat(DENO_LOCK);
  assert(info.isFile, "deno.lock must exist at the repository root");
});

Deno.test("deno.lock records integrity hashes for dependencies (Issue #2865)", async () => {
  const lock = JSON.parse(await Deno.readTextFile(DENO_LOCK));
  assert(
    typeof lock.version === "string" && lock.version.length > 0,
    "deno.lock must declare a lockfile format version",
  );

  // Collect every integrity hash recorded across the JSR/npm/remote sections.
  const integrities: string[] = [];
  for (const section of [lock.jsr, lock.npm, lock.remote]) {
    if (!section || typeof section !== "object") continue;
    for (const entry of Object.values(section as Record<string, unknown>)) {
      if (typeof entry === "string") {
        // `remote` maps specifier -> integrity hash directly.
        integrities.push(entry);
      } else if (entry && typeof entry === "object") {
        const hash = (entry as { integrity?: unknown }).integrity;
        if (typeof hash === "string") integrities.push(hash);
      }
    }
  }

  assert(
    integrities.length > 0,
    "deno.lock must record at least one dependency integrity hash so the " +
      "resolved dependency graph is verified on every cache/install/run",
  );
});

Deno.test("deno.lock pins the exact-pinned direct dependencies (Issue #2865)", async () => {
  const json = JSON.parse(await Deno.readTextFile(DENO_JSON));
  const lock = JSON.parse(await Deno.readTextFile(DENO_LOCK));

  // The lockfile must reference every direct jsr: import declared in deno.json.
  const jsrImports = Object.values(json.imports as Record<string, string>)
    .filter((spec) => spec.startsWith("jsr:"));

  const jsrSection = (lock.jsr ?? {}) as Record<string, unknown>;
  const specifiers = (lock.specifiers ?? {}) as Record<string, unknown>;
  const lockText = JSON.stringify(lock);

  for (const spec of jsrImports) {
    // e.g. "jsr:@std/crypto@1.1.0" -> bare "@std/crypto@1.1.0".
    const bare = spec.slice("jsr:".length).split("/").slice(0, 2).join("/");
    const pkgName = bare.split("@").slice(0, -1).join("@") || bare;
    const present = pkgName in jsrSection ||
      pkgName in specifiers ||
      lockText.includes(pkgName);
    assert(
      present,
      `deno.lock must pin direct dependency "${pkgName}" declared in deno.json`,
    );
  }
});
