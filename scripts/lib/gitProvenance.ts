/** Fail-loud git provenance (commit and dirty-tree) for study manifests. */

export async function gitCommit(): Promise<string> {
  const output = await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `git rev-parse HEAD failed: ${new TextDecoder().decode(output.stderr)}`,
    );
  }
  return new TextDecoder().decode(output.stdout).trim();
}

export /**
 * Whether `scripts/` or `src/` differ from `HEAD`. A recorded `commit` only
 * names the code that ran when this is false; otherwise `harnessSha256` is the
 * identity to check.
 */
async function dirtyTree(): Promise<boolean> {
  const output = await new Deno.Command("git", {
    args: ["status", "--porcelain", "--", "scripts", "src"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `git status failed: ${new TextDecoder().decode(output.stderr)}`,
    );
  }
  return new TextDecoder().decode(output.stdout).trim().length > 0;
}
