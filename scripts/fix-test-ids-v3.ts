#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * Comprehensive test file fixer v3.
 *
 * Strategy: For each failing test file:
 * 1. Read the pre-commit version (with legacy UUID format)
 * 2. Read the post-commit version (with wrong IDs)
 * 3. Build a complete UUID→correctId map from the pre-commit UUIDs
 * 4. Apply the map to the post-commit version to fix wrong IDs
 *
 * Also fixes:
 * - String values assigned to numeric fields (e.g., fromId = "mother-3")
 * - Mixed legacy/new format in synapse data
 * - Assertion value mismatches
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

function getPreCommitContent(file: string): string | null {
  try {
    const result = new Deno.Command("git", {
      args: ["show", `${parentCommit}:${file}`],
      stdout: "piped",
      stderr: "piped",
    }).outputSync();
    if (result.code !== 0) return null;
    return new TextDecoder().decode(result.stdout);
  } catch {
    return null;
  }
}

function extractUuids(content: string): Map<string, number> {
  const uuidMap = new Map<string, number>();

  // Extract ALL UUID strings from the content
  // Pattern: uuid: "X", fromUUID: "X", toUUID: "X"
  const uuidFieldPattern = /(?:uuid|fromUUID|toUUID):\s*"([^"]+)"/g;
  for (const m of content.matchAll(uuidFieldPattern)) {
    const uuid = m[1];
    uuidMap.set(uuid, uuidToId(uuid));
  }

  // Pattern: .uuid === "X" or .uuid !== "X"
  const uuidComparePattern = /\.uuid\s*[!=]==\s*"([^"]+)"/g;
  for (const m of content.matchAll(uuidComparePattern)) {
    const uuid = m[1];
    uuidMap.set(uuid, uuidToId(uuid));
  }

  // Pattern: ["X"] where X looks like a UUID
  const bracketPattern =
    /\["((?:input-|output-|hidden-|[a-f0-9]{8}-)[^"]+)"\]/g;
  for (const m of content.matchAll(bracketPattern)) {
    const uuid = m[1];
    uuidMap.set(uuid, uuidToId(uuid));
  }

  // Pattern: "uuid-key": value in object literal
  const objectKeyPattern = /"((?:input-|output-|hidden-)[^"]+)":/g;
  for (const m of content.matchAll(objectKeyPattern)) {
    const uuid = m[1];
    uuidMap.set(uuid, uuidToId(uuid));
  }

  return uuidMap;
}

function buildWrongToCorrectMap(
  preContent: string,
  postContent: string,
): Map<number, number> {
  // Get diff between pre and post to find UUID→wrongId pairs
  const mapping = new Map<number, number>();

  // Write temp files for diff
  const preFile = Deno.makeTempFileSync();
  const postFile = Deno.makeTempFileSync();
  Deno.writeTextFileSync(preFile, preContent);
  Deno.writeTextFileSync(postFile, postContent);

  const diffResult = new Deno.Command("diff", {
    args: ["-U0", preFile, postFile],
    stdout: "piped",
    stderr: "piped",
  }).outputSync();

  Deno.removeSync(preFile);
  Deno.removeSync(postFile);

  const diff = new TextDecoder().decode(diffResult.stdout);
  const hunks = diff.split(/^@@/m).slice(1);

  for (const hunk of hunks) {
    const lines = hunk.split("\n");
    const removedUuids: string[] = [];
    const addedIds: number[] = [];

    for (const line of lines) {
      if (line.startsWith("-")) {
        // Extract UUIDs from removed lines
        for (
          const m of line.matchAll(/(?:uuid|fromUUID|toUUID):\s*"([^"]+)"/g)
        ) {
          removedUuids.push(m[1]);
        }
        for (const m of line.matchAll(/\.uuid\s*[!=]==\s*"([^"]+)"/g)) {
          removedUuids.push(m[1]);
        }
        for (
          const m of line.matchAll(
            /\["((?:input-|output-|hidden-|[a-f0-9]{8}-)[^"]+)"\]/g,
          )
        ) {
          removedUuids.push(m[1]);
        }
      } else if (line.startsWith("+")) {
        // Extract IDs from added lines
        for (
          const m of line.matchAll(/(?:(?<!\w)id|fromId|toId):\s*(-?\d+)/g)
        ) {
          addedIds.push(parseInt(m[1]));
        }
        for (const m of line.matchAll(/\.id\s*[!=]==\s*(-?\d+)/g)) {
          addedIds.push(parseInt(m[1]));
        }
        for (const m of line.matchAll(/\[(-?\d+)\]/g)) {
          const v = parseInt(m[1]);
          if (Math.abs(v) >= 100) addedIds.push(v);
        }
      }
    }

    // Match in order
    const minLen = Math.min(removedUuids.length, addedIds.length);
    for (let i = 0; i < minLen; i++) {
      const correctId = uuidToId(removedUuids[i]);
      const wrongId = addedIds[i];
      if (wrongId !== correctId && !mapping.has(wrongId)) {
        mapping.set(wrongId, correctId);
      }
    }
  }

  return mapping;
}

function processFile(filePath: string): boolean {
  const preContent = getPreCommitContent(filePath);
  if (!preContent) return false;

  let content = Deno.readTextFileSync(filePath);
  const original = content;

  // Build UUID map from pre-commit content
  const uuidMap = extractUuids(preContent);

  // Build wrong→correct ID map from diff
  const wrongToCorrect = buildWrongToCorrectMap(preContent, content);

  // Also build a reverse lookup: for each UUID, what wrong ID was used?
  // This helps fix string-to-integer issues
  const uuidToWrongId = new Map<string, number>();
  for (const [wrongId, correctId] of wrongToCorrect) {
    for (const [uuid, cid] of uuidMap) {
      if (cid === correctId) {
        uuidToWrongId.set(uuid, wrongId);
        break;
      }
    }
  }

  // Fix 1: Replace wrong IDs with correct IDs (sort by ID length to avoid partial replacements)
  const entries = [...wrongToCorrect.entries()].sort(
    (a, b) => String(b[0]).length - String(a[0]).length,
  );

  for (const [wrongId, correctId] of entries) {
    if (wrongId === correctId) continue;

    const wrongStr = String(wrongId).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const correctStr = String(correctId);

    // Replace in id/fromId/toId contexts
    content = content.replace(
      new RegExp(
        `((?:(?<!\\w)id|fromId|toId|fromNeuronId|toNeuronId|neuronId):\\s*)${wrongStr}\\b`,
        "g",
      ),
      `$1${correctStr}`,
    );

    // Replace in .id === / !== comparisons
    content = content.replace(
      new RegExp(`(\\.id\\s*[!=]==\\s*)${wrongStr}\\b`, "g"),
      `$1${correctStr}`,
    );

    // Replace in object key context [wrongId]
    content = content.replace(
      new RegExp(`(\\[)${wrongStr}(\\])`, "g"),
      `$1${correctStr}$2`,
    );

    // Replace standalone wrong IDs in assertions like assertEquals(x, wrongId)
    content = content.replace(
      new RegExp(`(assertEquals\\([^,]+,\\s*)${wrongStr}(\\s*[,)])`, "g"),
      `$1${correctStr}$2`,
    );
  }

  // Fix 2: Fix string values assigned to numeric ID fields
  // Pattern: .id = "uuid-string" or fromId = "uuid-string" or toId = "uuid-string"
  content = content.replace(
    /((?:(?<!\w)id|fromId|toId)\s*=\s*)"([^"]+)"/g,
    (_match, prefix, uuid) => {
      const id = uuidToId(uuid);
      return `${prefix}${id}`;
    },
  );

  // Fix 3: Fix string values in object literals
  // Pattern: fromId: "uuid-string" or toId: "uuid-string" or id: "uuid-string"
  content = content.replace(
    /((?:(?<!\w)id|fromId|toId):\s*)"([^"]+)"/g,
    (_match, prefix, uuid) => {
      const id = uuidToId(uuid);
      return `${prefix}${id}`;
    },
  );

  // Fix 4: Fix template literal UUIDs that were left as strings
  // Pattern: `hidden-${i}` as unknown as number
  // These need manual review - flag them
  if (content.includes("as unknown as number")) {
    // Replace: "hidden-${i}" as unknown as number → deterministicIdFromUuid computed at runtime
    // This is complex - we may need to handle these case by case
  }

  // Fix 5: Fix "duplicate UUID" → "duplicate neuron id" in assertion strings
  content = content.replace(
    /duplicate UUID/g,
    "duplicate neuron id",
  );

  const changed = content !== original;
  if (changed) {
    Deno.writeTextFileSync(filePath, content);
  }
  return changed;
}

const files = Deno.args.filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.log("Usage: fix-test-ids-v3.ts <file1> ...");
  Deno.exit(1);
}

let totalChanged = 0;
for (const filePath of files) {
  try {
    if (processFile(filePath)) {
      totalChanged++;
    }
  } catch (e) {
    console.error(`Error: ${filePath}: ${e}`);
  }
}
console.log(`Total files updated: ${totalChanged}`);
