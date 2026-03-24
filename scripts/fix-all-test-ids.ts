#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * Fix ALL test files that have wrong integer IDs from commit 8e20a871.
 *
 * Strategy: For each file changed by the commit, take the pre-commit version,
 * apply it line by line with the commit's structural changes BUT with correct
 * integer ID values computed from the original UUIDs.
 *
 * This script patches the current (post-commit) files by finding and replacing
 * every wrong ID with the correct one, computed from the original UUID string.
 */

function deterministicIdFromUuid(uuid: string): number {
  let hash = 0;
  for (let i = 0; i < uuid.length; i++) {
    const chr = uuid.charCodeAt(i);
    hash = ((hash << 5) - hash + chr) | 0;
  }
  return 1_000_000 + Math.abs(hash % 1_999_000_000);
}

function uuidToId(uuid: string): number {
  const inputMatch = uuid.match(/^input-(\d+)$/);
  if (inputMatch) return parseInt(inputMatch[1]);
  const outputMatch = uuid.match(/^output-(\d+)$/);
  if (outputMatch) return -(parseInt(outputMatch[1]) + 1);
  return deterministicIdFromUuid(uuid);
}

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

// For each file, build a per-line map of UUID→wrongId→correctId
// by comparing the pre-commit and post-commit versions line by line
function buildLineMapping(
  oldContent: string,
  newContent: string,
): Map<string, number> {
  // Use unified diff to align old and new lines
  const oldFile = Deno.makeTempFileSync({ suffix: ".ts" });
  const newFile = Deno.makeTempFileSync({ suffix: ".ts" });
  Deno.writeTextFileSync(oldFile, oldContent);
  Deno.writeTextFileSync(newFile, newContent);

  const diffResult = new Deno.Command("diff", {
    args: ["-U1", oldFile, newFile],
    stdout: "piped",
    stderr: "piped",
  }).outputSync();

  Deno.removeSync(oldFile);
  Deno.removeSync(newFile);

  const diff = new TextDecoder().decode(diffResult.stdout);

  // Map: wrongIdString → correctId
  const mapping = new Map<string, number>();

  // Process hunks
  const hunks = diff.split(/^@@/m).slice(1);

  for (const hunk of hunks) {
    const lines = hunk.split("\n");
    // Collect removed (old) and added (new) lines in sequence
    const removed: string[] = [];
    const added: string[] = [];

    for (const line of lines) {
      if (line.startsWith("-") && !line.startsWith("---")) {
        removed.push(line.substring(1));
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        added.push(line.substring(1));
      } else if (line.startsWith(" ") || line === "") {
        // Context line - process accumulated removed/added pairs
        processLinePairs(removed, added, mapping);
        removed.length = 0;
        added.length = 0;
      }
    }
    // Process remaining
    processLinePairs(removed, added, mapping);
  }

  return mapping;
}

function processLinePairs(
  removed: string[],
  added: string[],
  mapping: Map<string, number>,
): void {
  // Try to match removed and added lines 1:1
  const minLen = Math.min(removed.length, added.length);
  for (let i = 0; i < minLen; i++) {
    const oldLine = removed[i];
    const newLine = added[i];

    // Extract ALL UUIDs from old line
    const oldUuids: string[] = [];
    for (const m of oldLine.matchAll(/"([^"]+)"/g)) {
      const val = m[1];
      // Only consider values that look like UUIDs/identifiers, not random strings
      if (
        val.match(/^(input-|output-|hidden-)/) ||
        val.match(/^[a-z]+-[a-z0-9]+/) ||
        val.match(/^[a-f0-9]{8}-/) ||
        val.match(/^[a-z]{2,}[A-Z]/) || // camelCase
        val.match(/^[a-z_-]{2,}$/) // simple identifiers
      ) {
        oldUuids.push(val);
      }
    }

    // Extract ALL integers from new line
    const newInts: Array<{ value: number; str: string; index: number }> = [];
    for (const m of newLine.matchAll(/(?<![a-zA-Z_])(-?\d{2,})\b/g)) {
      const v = parseInt(m[1]);
      // Skip small numbers that are likely not IDs (weights, biases, etc.)
      // Also skip numbers that look like line numbers or other non-IDs
      if (m.index !== undefined) {
        newInts.push({ value: v, str: m[1], index: m.index });
      }
    }

    // Match UUIDs to integers
    if (oldUuids.length > 0 && newInts.length > 0) {
      let intIdx = 0;
      for (const uuid of oldUuids) {
        const correctId = uuidToId(uuid);
        // Find the next integer in the new line that could be the replacement
        while (intIdx < newInts.length) {
          const wrongId = newInts[intIdx].value;
          intIdx++;
          if (wrongId !== correctId && Math.abs(wrongId) >= 2) {
            // This is likely a wrong replacement
            mapping.set(String(wrongId), correctId);
          }
          break;
        }
      }
    }
  }
}

function fixFile(filePath: string): boolean {
  const oldContent = gitShow(parentCommit, filePath);
  if (!oldContent) return false;

  const newContent = Deno.readTextFileSync(filePath);
  const lineMapping = buildLineMapping(oldContent, newContent);

  if (lineMapping.size === 0) return false;

  let content = newContent;

  // Sort mappings by wrong ID string length (longest first) to avoid partial replacements
  const entries = [...lineMapping.entries()].sort(
    (a, b) => b[0].length - a[0].length,
  );

  for (const [wrongIdStr, correctId] of entries) {
    const correctStr = String(correctId);
    if (wrongIdStr === correctStr) continue;

    const escaped = wrongIdStr.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    // Replace in field assignment contexts
    content = content.replace(
      new RegExp(
        `((?:(?<![a-zA-Z])id|fromId|toId|fromNeuronId|toNeuronId|neuronId)\\s*[:=]\\s*)${escaped}\\b`,
        "g",
      ),
      `$1${correctStr}`,
    );

    // Replace in comparison contexts
    content = content.replace(
      new RegExp(`(\\.id\\s*[!=]==\\s*)${escaped}\\b`, "g"),
      `$1${correctStr}`,
    );

    // Replace in object key contexts
    content = content.replace(
      new RegExp(`(\\[)${escaped}(\\])`, "g"),
      `$1${correctStr}$2`,
    );
  }

  // Also fix string-to-number issues: id = "uuid-string"
  content = content.replace(
    /((?:(?<![a-zA-Z])id|fromId|toId)\s*=\s*)"([^"]+)"/g,
    (_match, prefix, uuid) => {
      if (uuid.match(/^[a-z]/) || uuid.match(/^[A-Z]/)) {
        return `${prefix}${uuidToId(uuid)}`;
      }
      return _match;
    },
  );

  // Fix: id: "string" in object literals (shouldn't be string)
  content = content.replace(
    /((?:(?<![a-zA-Z])id|fromId|toId):\s*)"([^"]+)"/g,
    (_match, prefix, value) => {
      // Only fix if it looks like a UUID, not a CRISPR id which IS a string
      if (value.match(/^(input-|output-|hidden-|[a-z]+-[a-z])/)) {
        return `${prefix}${uuidToId(value)}`;
      }
      return _match;
    },
  );

  // Fix "duplicate UUID" → "duplicate neuron id"
  content = content.replace(/duplicate UUID/g, "duplicate neuron id");

  if (content !== newContent) {
    Deno.writeTextFileSync(filePath, content);
    return true;
  }
  return false;
}

// Get all test files that were changed by the commit
const filesResult = new Deno.Command("git", {
  args: ["diff", "--name-only", parentCommit, commit, "--", "test/"],
  stdout: "piped",
  stderr: "piped",
}).outputSync();

const allChangedFiles = new TextDecoder().decode(filesResult.stdout)
  .trim().split("\n")
  .filter((f) => f.endsWith(".ts"));

// Also handle files passed as arguments
const argFiles = Deno.args.filter((a) => !a.startsWith("--"));
const filesToProcess = argFiles.length > 0 ? argFiles : allChangedFiles;

console.log(`Processing ${filesToProcess.length} files...`);
let totalChanged = 0;
let errors = 0;
for (const filePath of filesToProcess) {
  try {
    if (fixFile(filePath)) {
      totalChanged++;
    }
  } catch (e) {
    errors++;
    console.error(`Error: ${filePath}: ${e}`);
  }
}
console.log(`Total files updated: ${totalChanged}, errors: ${errors}`);
