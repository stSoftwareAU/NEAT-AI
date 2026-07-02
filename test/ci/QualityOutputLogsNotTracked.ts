/**
 * Issue #3188 — the generated quality-gate output logs must not be committed.
 *
 * `quality-output.log` and `quality-output.txt` are captured output of the
 * repo's `quality.sh` quality gate, not source. Committing generated artefacts
 * bloats every clone and fetch, permanently inflates the pack (the blobs stay
 * in history), and produces enormous unreviewable diffs on each regeneration.
 *
 * These tests assert behaviourally, via git, that:
 *   1. neither file is tracked in the committed tree, and
 *   2. the root `.gitignore` ignores both names so a regenerated log is never
 *      accidentally re-added.
 */

import { assert, assertEquals } from "@std/assert";
import { fromFileUrl } from "@std/path";

const REPO_ROOT = fromFileUrl(new URL("../../", import.meta.url));

const GENERATED_LOGS = ["quality-output.log", "quality-output.txt"] as const;

async function git(
  ...args: string[]
): Promise<{ code: number; stdout: string }> {
  const command = new Deno.Command("git", {
    args,
    cwd: REPO_ROOT,
    stdout: "piped",
    stderr: "null",
  });
  const { code, stdout } = await command.output();
  return { code, stdout: new TextDecoder().decode(stdout).trim() };
}

Deno.test(
  "generated quality-output logs are not tracked by git (Issue #3188)",
  async () => {
    const { stdout } = await git("ls-files", ...GENERATED_LOGS);
    assertEquals(
      stdout,
      "",
      `generated log(s) still tracked in the committed tree: ${stdout}. ` +
        "Run `git rm --cached quality-output.log quality-output.txt`.",
    );
  },
);

Deno.test(
  "root .gitignore ignores the generated quality-output logs (Issue #3188)",
  async () => {
    const results = await Promise.all(
      GENERATED_LOGS.map(async (name) => ({
        name,
        ...(await git("check-ignore", name)),
      })),
    );
    for (const { name, code, stdout } of results) {
      assert(
        code === 0 && stdout === name,
        `${name} is not ignored by .gitignore; add a 'quality-output.*' ` +
          "rule so regenerated logs are never re-committed.",
      );
    }
  },
);
