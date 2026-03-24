#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * Build a comprehensive UUID→wrong-ID mapping by comparing pre-commit and post-commit
 * versions of each test file. Instead of parsing diffs line-by-line, this:
 * 1. Reads the pre-commit version and extracts ALL UUID strings used
 * 2. Reads the post-commit version and extracts ALL integer IDs used
 * 3. Matches them structurally (same file position / context)
 * 4. Computes correct IDs and builds wrong→correct mapping
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

// Get all test files changed by the commit
const filesResult = new Deno.Command("git", {
  args: ["diff", "--name-only", parentCommit, commit, "--", "test/"],
  stdout: "piped",
  stderr: "piped",
}).outputSync();

const changedFiles = new TextDecoder().decode(filesResult.stdout)
  .trim().split("\n").filter((f) => f.endsWith(".ts"));

console.log(`Files changed by commit: ${changedFiles.length}`);

const allMappings: Record<string, Record<string, number>> = {};

// For each changed file, extract all UUID→ID pairs from the diff
for (const file of changedFiles) {
  try {
    // Get the unified diff with full context
    const diffResult = new Deno.Command("git", {
      args: ["diff", "-U0", parentCommit, commit, "--", file],
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    if (diffResult.code !== 0) continue;

    const diff = new TextDecoder().decode(diffResult.stdout);

    // Extract UUID→wrongId pairs from adjacent -/+ lines in diff
    const mapping: Record<string, number> = {};

    // Strategy: collect all UUIDs from removed lines and IDs from added lines
    // in each contiguous changed hunk, then match them in order
    const hunks = diff.split(/^@@/m).slice(1);

    for (const hunk of hunks) {
      const lines = hunk.split("\n");
      const removedUuids: string[] = [];
      const addedIds: number[] = [];

      for (const line of lines) {
        if (line.startsWith("-")) {
          // Extract ALL UUID-like strings from removed lines
          const uuidMatches = line.matchAll(
            /(?:uuid|fromUUID|toUUID):\s*"([^"]+)"/g,
          );
          for (const m of uuidMatches) removedUuids.push(m[1]);

          const propMatches = line.matchAll(/\.uuid\s*===?\s*"([^"]+)"/g);
          for (const m of propMatches) removedUuids.push(m[1]);

          const indexMatches = line.matchAll(/\["([^"]+)"\]/g);
          for (const m of indexMatches) {
            if (m[1].match(/^(input-\d+|output-\d+|hidden-|[a-f0-9-]{8,})/)) {
              removedUuids.push(m[1]);
            }
          }

          // Record<string, ...> patterns with UUID keys
          const recordMatches = line.matchAll(
            /"((?:input-|output-|hidden-)[^"]+)":/g,
          );
          for (const m of recordMatches) removedUuids.push(m[1]);
        } else if (line.startsWith("+")) {
          // Extract ALL integer IDs from added lines
          const idMatches = line.matchAll(/(?:id|fromId|toId):\s*(-?\d+)/g);
          for (const m of idMatches) addedIds.push(parseInt(m[1]));

          const propMatches = line.matchAll(/\.id\s*===?\s*(-?\d+)/g);
          for (const m of propMatches) addedIds.push(parseInt(m[1]));

          const indexMatches = line.matchAll(/\[(-?\d+)\]/g);
          for (const m of indexMatches) {
            const v = parseInt(m[1]);
            if (Math.abs(v) > 100) addedIds.push(v);
          }

          // Record<number, ...> patterns with ID keys
          const recordMatches = line.matchAll(/(\d{4,}):/g);
          for (const m of recordMatches) {
            const v = parseInt(m[1]);
            if (v > 100) addedIds.push(v);
          }
        }
      }

      // Match UUIDs to IDs in order
      const minLen = Math.min(removedUuids.length, addedIds.length);
      for (let i = 0; i < minLen; i++) {
        const uuid = removedUuids[i];
        const wrongId = addedIds[i];
        const correctId = uuidToId(uuid);
        if (wrongId !== correctId) {
          mapping[String(wrongId)] = correctId;
        }
      }
    }

    if (Object.keys(mapping).length > 0) {
      allMappings[file] = mapping;
    }
  } catch {
    // Skip
  }
}

Deno.writeTextFileSync(
  "/tmp/id_mappings_v2.json",
  JSON.stringify(allMappings, null, 2),
);

console.log("Files with mappings: " + Object.keys(allMappings).length);
let total = 0;
for (const m of Object.values(allMappings)) total += Object.keys(m).length;
console.log("Total mappings: " + total);

// Also output a global mapping (for patterns that repeat across files)
const globalMapping: Record<string, number> = {};
for (const m of Object.values(allMappings)) {
  for (const [wrongId, correctId] of Object.entries(m)) {
    if (globalMapping[wrongId] === undefined) {
      globalMapping[wrongId] = correctId;
    } else if (globalMapping[wrongId] !== correctId) {
      console.warn(
        `Conflict for ${wrongId}: ${globalMapping[wrongId]} vs ${correctId}`,
      );
    }
  }
}
console.log("Unique global mappings: " + Object.keys(globalMapping).length);
Deno.writeTextFileSync(
  "/tmp/id_global_mapping.json",
  JSON.stringify(globalMapping, null, 2),
);
