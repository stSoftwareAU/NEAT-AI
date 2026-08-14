/**
 * Issue #3689 — guard against a stale, hand-maintained `src/` tree in
 * CONTRIBUTING.md.
 *
 * The "Project Structure" section listed 14 `src/` subdirectories while the
 * real tree had roughly 33, so a newcomer concluded the codebase had no ONNX,
 * transfer-learning, presets or predictive-coding modules. It also annotated
 * `wasm_activation/` as holding Rust source, which CONTRIBUTING.md itself
 * contradicts ("Rust/Cargo is no longer built in-tree").
 *
 * These guards mirror `test/docs/AgentsDirectoryStructure.ts`: read the real
 * `src/` layout and assert the section never re-introduces a partial per-module
 * listing, and that the `wasm_activation/` annotation stays truthful.
 */

import { assert } from "@std/assert";

const HEADING = "## 📁 Project Structure";

/** Extract the body of the "Project Structure" heading up to the next `##`. */
function projectStructureSection(text: string): string {
  const start = text.indexOf(HEADING);
  assert(
    start !== -1,
    "CONTRIBUTING.md is missing the Project Structure heading",
  );
  const rest = text.slice(start + HEADING.length);
  const end = rest.indexOf("\n## ");
  return end === -1 ? rest : rest.slice(0, end);
}

async function readSection(): Promise<string> {
  const contributing = await Deno.readTextFile(
    new URL("../../CONTRIBUTING.md", import.meta.url),
  );
  return projectStructureSection(contributing);
}

Deno.test(
  "CONTRIBUTING.md Project Structure does not embed a partial src/ module tree",
  async () => {
    const section = await readSection();

    // Live subsystem directories directly under src/.
    const srcRoot = new URL("../../src/", import.meta.url);
    const liveSubsystems: string[] = [];
    for await (const entry of Deno.readDir(srcRoot)) {
      if (entry.isDirectory) liveSubsystems.push(entry.name);
    }
    assert(liveSubsystems.length > 0, "expected src/ to contain subsystems");

    const listed = liveSubsystems.filter((name) =>
      section.includes(`${name}/`)
    );
    const omitted = liveSubsystems.filter((name) => !listed.includes(name));

    // A partial listing is exactly the stale-tree failure mode: some subsystems
    // documented, others silently omitted. Require all-or-nothing.
    assert(
      listed.length === 0 || omitted.length === 0,
      `CONTRIBUTING.md Project Structure embeds a partial src/ tree: ` +
        `${listed.length}/${liveSubsystems.length} subsystems listed, ` +
        `omitting [${omitted.sort().join(", ")}]. Point to src/ as the ` +
        `single source of truth instead of maintaining the list by hand.`,
    );
  },
);

Deno.test(
  "CONTRIBUTING.md Project Structure points to src/ as source of truth",
  async () => {
    const section = await readSection();
    assert(
      section.includes("`src/`"),
      "CONTRIBUTING.md Project Structure should reference `src/` as the source layout",
    );
    assert(
      section.includes("AGENTS.md"),
      "CONTRIBUTING.md Project Structure should link to the AGENTS.md Directory Structure section",
    );
  },
);

Deno.test(
  "CONTRIBUTING.md does not claim in-tree Rust source under wasm_activation/",
  async () => {
    const section = await readSection();
    // Rust source is no longer built in-tree; wasm_activation/ holds only the
    // vendored pkg/ artefacts synced from NEAT-AI-core.
    assert(
      !/wasm_activation\/[^\n]*Rust source/i.test(section),
      "CONTRIBUTING.md must not describe wasm_activation/ as containing Rust source — " +
        "it holds vendored WASM artefacts from NEAT-AI-core only",
    );

    const rustSourceDir = new URL(
      "../../wasm_activation/src/",
      import.meta.url,
    );
    let hasRustSource = false;
    try {
      await Deno.stat(rustSourceDir);
      hasRustSource = true;
    } catch {
      hasRustSource = false;
    }
    assert(
      !hasRustSource,
      "wasm_activation/src/ exists — the docs guard above needs revisiting",
    );
  },
);
