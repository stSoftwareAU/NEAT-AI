/**
 * Issue #3285 — guard against a stale, hand-maintained `src/` tree in AGENTS.md.
 *
 * The "Directory Structure" section of AGENTS.md previously embedded a
 * per-module `src/` listing that drifted from the real source layout: eight
 * live subsystems (`cache/`, `neuron/`, `onnx/`, `predictiveCoding/`,
 * `presets/`, `score/`, `transfer/`, `workers/`) existed on disk but were
 * absent from the tree, misleading contributors into thinking those subsystems
 * did not exist.
 *
 * The fix replaces that drift-prone enumeration with a pointer to `src/` as the
 * single source of truth. This behavioural guard reads the real `src/` layout
 * and the AGENTS.md section, then asserts the section does NOT re-introduce a
 * partial per-module listing — it must enumerate either every live subsystem or
 * none of them, so a subset that silently omits new subsystems cannot creep
 * back in.
 */

import { assert } from "@std/assert";

/** Extract the body of the "Directory Structure" heading up to the next `###`. */
function directoryStructureSection(text: string): string {
  const start = text.indexOf("### 📂 Directory Structure");
  assert(start !== -1, "AGENTS.md is missing the Directory Structure heading");
  const rest = text.slice(start + "### 📂 Directory Structure".length);
  const end = rest.indexOf("\n### ");
  return end === -1 ? rest : rest.slice(0, end);
}

Deno.test(
  "AGENTS.md Directory Structure does not embed a partial src/ module tree",
  async () => {
    const agents = await Deno.readTextFile(
      new URL("../../AGENTS.md", import.meta.url),
    );
    const section = directoryStructureSection(agents);

    // Live subsystem directories directly under src/.
    const srcRoot = new URL("../../src/", import.meta.url);
    const liveSubsystems: string[] = [];
    for await (const entry of Deno.readDir(srcRoot)) {
      if (entry.isDirectory) liveSubsystems.push(entry.name);
    }
    assert(liveSubsystems.length > 0, "expected src/ to contain subsystems");

    // Which live subsystems are named as `<name>/` inside the section?
    const listed = liveSubsystems.filter((name) =>
      section.includes(`${name}/`)
    );

    // A partial listing is exactly the stale-tree failure mode: some subsystems
    // documented, others silently omitted. Require all-or-nothing.
    const omitted = liveSubsystems.filter((name) => !listed.includes(name));
    assert(
      listed.length === 0 || omitted.length === 0,
      `AGENTS.md Directory Structure embeds a partial src/ tree: ` +
        `${listed.length}/${liveSubsystems.length} subsystems listed, ` +
        `omitting [${omitted.sort().join(", ")}]. Point to src/ as the ` +
        `single source of truth instead of maintaining the list by hand.`,
    );
  },
);

Deno.test("AGENTS.md Directory Structure points to src/ as source of truth", async () => {
  const agents = await Deno.readTextFile(
    new URL("../../AGENTS.md", import.meta.url),
  );
  const section = directoryStructureSection(agents);
  assert(
    section.includes("`src/`"),
    "AGENTS.md Directory Structure should reference `src/` as the source layout",
  );
});
