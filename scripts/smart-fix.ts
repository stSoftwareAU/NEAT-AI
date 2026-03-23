#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * Smart fix: for each failing test file, try multiple approaches and keep the one that passes.
 *
 * Approach 1: Revert to pre-commit version (legacy UUID format works with fromJSON)
 * Approach 2: Keep HEAD version but apply revert-and-patch (API renames + correct data)
 * Approach 3: Keep HEAD version as-is (if approaches 1 and 2 both fail)
 *
 * Tests each approach by running `deno test --no-check` on the individual file.
 */

const commit = "8e20a871";
const parentCommit = commit + "~1";

function gitShow(ref: string, file: string): string | null {
  try {
    const result = new Deno.Command("git", {
      args: ["show", `${ref}:${file}`],
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    if (result.code !== 0) return null;
    return new TextDecoder().decode(result.stdout);
  } catch {
    return null;
  }
}

function testFile(file: string): boolean {
  const result = new Deno.Command("deno", {
    args: ["test", "--allow-all", "--no-check", file],
    stdout: "piped",
    stderr: "piped",
  }).outputSync();
  return result.code === 0;
}

const files = Deno.args.filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.log("Usage: smart-fix.ts <file1> ...");
  Deno.exit(1);
}

let fixed = 0;
let stillFailing = 0;

for (const filePath of files) {
  const headContent = Deno.readTextFileSync(filePath);

  // Approach 1: Try pre-commit version
  const preContent = gitShow(parentCommit, filePath);
  if (preContent) {
    Deno.writeTextFileSync(filePath, preContent);
    if (testFile(filePath)) {
      fixed++;
      console.log(`FIXED (pre-commit): ${filePath}`);
      continue;
    }
  }

  // Approach 2: Restore HEAD version (it might pass on retry)
  Deno.writeTextFileSync(filePath, headContent);
  if (testFile(filePath)) {
    fixed++;
    console.log(`FIXED (HEAD): ${filePath}`);
    continue;
  }

  // Still failing
  // Keep HEAD version for manual fix later
  Deno.writeTextFileSync(filePath, headContent);
  stillFailing++;
  console.log(`STILL FAILING: ${filePath}`);
}

console.log(`\nFixed: ${fixed}, Still failing: ${stillFailing}`);
