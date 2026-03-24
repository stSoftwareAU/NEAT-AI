#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * Comprehensive test file fixer:
 * 1. Convert remaining uuid/fromUUID/toUUID to id/fromId/toId
 * 2. Replace wrong hardcoded IDs with correct deterministic IDs
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

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// Load mappings
let idMappings: Record<string, Record<string, number>> = {};
try {
  idMappings = JSON.parse(Deno.readTextFileSync("/tmp/id_mappings_final.json"));
} catch {
  // No mappings
}

function processFile(filePath: string): boolean {
  let content = Deno.readTextFileSync(filePath);
  const original = content;

  // Phase 1: Convert remaining uuid/fromUUID/toUUID patterns

  // Convert fromUUID: "X" → fromId: uuidToId("X")
  content = content.replace(
    /fromUUID:\s*"([^"]+)"/g,
    (_m, uuid) => `fromId: ${uuidToId(uuid)}`,
  );

  // Convert toUUID: "X" → toId: uuidToId("X")
  content = content.replace(
    /toUUID:\s*"([^"]+)"/g,
    (_m, uuid) => `toId: ${uuidToId(uuid)}`,
  );

  // Remove uuid: "output-N"
  content = content.replace(/,\s*uuid:\s*"output-\d+"/g, "");
  content = content.replace(/uuid:\s*"output-\d+"\s*,\s*/g, "");
  content = content.replace(/uuid:\s*"output-\d+"/g, "");

  // Convert uuid: "X" → id: deterministicIdFromUuid("X")
  content = content.replace(
    /uuid:\s*"([^"]+)"/g,
    (_m, uuid) => {
      if (uuid.match(/^input-\d+$/)) return _m;
      return `id: ${deterministicIdFromUuid(uuid)}`;
    },
  );

  // Phase 2: Replace wrong IDs using per-file mapping
  const relPath = filePath.replace(/^.*?(test\/)/, "$1");
  const mapping = idMappings[relPath];

  if (mapping) {
    // Sort by wrong ID length descending to avoid partial replacements
    const entries = Object.entries(mapping).sort(
      (a, b) => b[0].length - a[0].length,
    );

    for (const [wrongIdStr, correctId] of entries) {
      const wrongId = parseInt(wrongIdStr);
      if (wrongId === correctId) continue;

      const wrongStr = escapeRegex(String(wrongId));
      const correctStr = String(correctId);

      // Replace in ID comparison contexts: .id === WRONG, .id !== WRONG
      content = content.replace(
        new RegExp(`(\\.id\\s*[!=]==\\s*)${wrongStr}\\b`, "g"),
        `$1${correctStr}`,
      );

      // Replace in fromId: WRONG (synapse JSON)
      content = content.replace(
        new RegExp(`(fromId:\\s*)${wrongStr}\\b`, "g"),
        `$1${correctStr}`,
      );

      // Replace in toId: WRONG (synapse JSON)
      content = content.replace(
        new RegExp(`(toId:\\s*)${wrongStr}\\b`, "g"),
        `$1${correctStr}`,
      );

      // Replace standalone id: WRONG (neuron JSON - careful not to match fromId/toId)
      // Only match if the wrong ID is small (not already a deterministicIdFromUuid result)
      if (Math.abs(wrongId) < 1_000_000) {
        content = content.replace(
          new RegExp(`(\\bid:\\s*)${wrongStr}\\b`, "g"),
          `$1${correctStr}`,
        );
      }

      // Replace in object key context: [WRONG] or ["WRONG"]
      content = content.replace(
        new RegExp(`(\\[)${wrongStr}(\\])`, "g"),
        `$1${correctStr}$2`,
      );

      // Replace in s.fromId === WRONG, n.id !== WRONG etc.
      // Already handled above
    }
  }

  const changed = content !== original;
  if (changed) {
    Deno.writeTextFileSync(filePath, content);
  }
  return changed;
}

const files = Deno.args.filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.log("Usage: fix-test-ids.ts <file1> ...");
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
