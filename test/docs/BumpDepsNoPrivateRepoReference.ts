/**
 * Issue #3458 — the dependency-bump automation, its contributor docs and its
 * tests must stay self-contained for public readers.
 *
 * The orchestration repository that runs `bump-deps.sh` is **private**, so an
 * issue-tracker slug naming it points public readers (and public users running
 * the script) at issues they cannot open — two of the offending slugs were
 * printed to stderr at runtime. The behaviour being described (the automated
 * worker reverts the bump when an audit gate fails) is expressible at concept
 * level, so this guard fails if any of those files reintroduces a private-repo
 * slug, and checks the runtime failure message itself.
 *
 * This file is a private-repo *detector*: it embeds the forbidden slug verbatim
 * as fixtures to verify its own detection logic, so it never scans itself.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

/** Files reworded by #3458; each must stay free of private-repo slugs. */
const GUARDED_FILES = [
  "../../bump-deps.sh",
  "../../AGENTS.md",
  "../../test/scripts/BumpDepsScript.ts",
];

/**
 * Match a reference to the private orchestration repository: an issue-tracker
 * slug (`VibeCoding#1613`, `stSoftwareAU/VibeCoding#3532`) or an org-qualified
 * repo path (`stSoftwareAU/VibeCoding`, `github.com/stSoftwareAU/VibeCoding`).
 *
 * The public `stSoftwareAU/NEAT-AI` repo and this repo's own `#NNNN` issue
 * references do not match.
 */
const PRIVATE_REPO_PATTERN = /VibeCoding#\d+|stSoftwareAU\/VibeCoding/;

/**
 * Return every 1-indexed line number carrying a private orchestration-repo
 * issue slug or org-qualified repo path.
 *
 * @param source raw file content
 * @returns 1-indexed line numbers with a private-repo reference
 */
export function findPrivateRepoRefs(source: string): number[] {
  const hits: number[] = [];
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (PRIVATE_REPO_PATTERN.test(lines[i])) {
      hits.push(i + 1);
    }
  }
  return hits;
}

for (const rel of GUARDED_FILES) {
  Deno.test(`${rel} has no private-repo reference (#3458)`, async () => {
    const path = fromFileUrl(new URL(rel, import.meta.url));
    const source = await Deno.readTextFile(path);
    const hits = findPrivateRepoRefs(source);
    assertEquals(
      hits,
      [],
      `${rel} references the private orchestration repository on line(s) ` +
        `${hits.join(", ")}. Reword to concept level (e.g. "the automated ` +
        `dependency-bump worker reverts the bump") so the file stays usable ` +
        `by public readers.`,
    );
  });
}

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

Deno.test("findPrivateRepoRefs flags a bare VibeCoding# slug", () => {
  const src = [
    "Intro line.",
    "The worker then reverts per the VibeCoding#1613 contract.",
    "Closing line.",
  ].join("\n");
  assertEquals(findPrivateRepoRefs(src), [2]);
});

Deno.test("findPrivateRepoRefs flags an org-qualified VibeCoding# slug", () => {
  const src = "worker-side PATH bootstrap (stSoftwareAU/VibeCoding#3532).\n";
  assertEquals(findPrivateRepoRefs(src), [1]);
});

Deno.test("findPrivateRepoRefs flags a private-repo blob URL", () => {
  const src = "see https://github.com/stSoftwareAU/VibeCoding/blob/main/x.md\n";
  assertEquals(findPrivateRepoRefs(src), [1]);
});

Deno.test("findPrivateRepoRefs ignores this repo's own issue references", () => {
  const src = [
    "Audit gate (two-phase, Issue #2465):",
    "See https://github.com/stSoftwareAU/NEAT-AI/issues/2460 for context.",
  ].join("\n");
  assertEquals(findPrivateRepoRefs(src), []);
});

Deno.test("findPrivateRepoRefs returns empty for concept-level prose", () => {
  const src = [
    "The automated dependency-bump worker reverts the bump when a gate fails.",
    "Worker should revert this bump.",
  ].join("\n");
  assertEquals(findPrivateRepoRefs(src), []);
});

Deno.test("findPrivateRepoRefs returns empty for empty input", () => {
  assertEquals(findPrivateRepoRefs(""), []);
});
