#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * Revert-and-patch strategy:
 * 1. Restore each test file to its pre-commit state (legacy UUID format)
 * 2. Apply ONLY the API-level changes needed for the new code:
 *    - .uuid property access → .id
 *    - .fromUUID property access → .fromId
 *    - .toUUID property access → .toId
 *    - getHiddenNeuronUUIDs() → getHiddenNeuronIds()
 *    - buildUuidToIndexMap → buildIdToIndexMap
 *    - getSuccessfulRemovalNeuronUUIDs → getSuccessfulRemovalNeuronIds
 *    - Record<string, string> aliases → Record<number, number>
 *    - Type SynapseExport used where now needs Record<string, unknown>
 *    - import type { SynapseExport } removal if no longer needed
 *    - "duplicate UUID" → "duplicate neuron id" in assertion strings
 *
 * The key insight: Creature.fromJSON() supports legacy UUID format in JSON data,
 * so we DON'T need to convert the creature JSON. We only need to change code
 * that accesses properties on the resulting objects.
 *
 * For CRISPR tests, the CrisprInterface no longer supports fromUUID/toUUID,
 * so those JSON literals DO need conversion.
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

function patchFile(filePath: string): boolean {
  // Step 1: Get pre-commit version
  const preContent = gitShow(parentCommit, filePath);
  if (!preContent) return false;

  let content = preContent;
  const original = content;

  // Step 2: Apply API-level patches

  // -- Method renames --
  content = content.replace(/getHiddenNeuronUUIDs/g, "getHiddenNeuronIds");
  content = content.replace(/buildUuidToIndexMap/g, "buildIdToIndexMap");
  content = content.replace(/getSuccessfulRemovalNeuronUUIDs/g, "getSuccessfulRemovalNeuronIds");

  // -- Property access on Neuron objects (NOT in JSON data) --
  // .uuid access → .id access (but NOT uuid: "X" in JSON)
  // Patterns: n.uuid, neuron.uuid, creature.neurons[X].uuid, etc.
  content = content.replace(/(\w)\.uuid(\s*[!=<>])/g, "$1.id$2");
  content = content.replace(/(\w)\.uuid(\s*\))/g, "$1.id$2");
  content = content.replace(/(\w)\.uuid(\s*,)/g, "$1.id$2");
  content = content.replace(/(\w)\.uuid(\s*;)/g, "$1.id$2");
  content = content.replace(/(\w)\.uuid(\s*\})/g, "$1.id$2");
  content = content.replace(/(\])\.uuid/g, "$1.id");
  content = content.replace(/(\))\.uuid/g, "$1.id");
  // .uuid! access
  content = content.replace(/(\w)\.uuid!/g, "$1.id!");
  // Map UUID → Map ID
  content = content.replace(/\.uuid\b/g, (match, offset) => {
    // Don't replace if preceded by quote (inside JSON key like "uuid")
    const before = content.substring(Math.max(0, offset - 2), offset);
    if (before.endsWith('"') || before.endsWith("'")) return match;
    return ".id";
  });

  // -- Property access on SynapseExport objects --
  // .fromUUID access → .fromId
  content = content.replace(/\.fromUUID\b/g, ".fromId");
  // .toUUID access → .toId
  content = content.replace(/\.toUUID\b/g, ".toId");

  // -- CrisprInterface synapse fields --
  // In CRISPR test data, convert fromUUID: "X" → fromId: uuidToId("X")
  // and toUUID: "X" → toId: uuidToId("X")
  if (filePath.includes("CRISPR") || filePath.includes("crispr")) {
    content = content.replace(
      /fromUUID:\s*"([^"]+)"/g,
      (_m, uuid) => `fromId: ${uuidToId(uuid)}`,
    );
    content = content.replace(
      /toUUID:\s*"([^"]+)"/g,
      (_m, uuid) => `toId: ${uuidToId(uuid)}`,
    );
    // Convert neuron uuid in CRISPR data: uuid: "X" → id: deterministicIdFromUuid("X")
    content = content.replace(
      /(\s+)uuid:\s*"([^"]+)"/g,
      (_m, ws, uuid) => {
        // Skip output-N UUIDs (they're auto-derived)
        if (uuid.match(/^output-\d+$/)) return _m;
        return `${ws}id: ${uuidToId(uuid)}`;
      },
    );
  }

  // -- Type annotation changes --
  // Record<string, string> → Record<number, number> for alias maps
  content = content.replace(
    /aliases:\s*Record<string,\s*string>/g,
    "aliases: Record<number, number>",
  );
  content = content.replace(
    /const aliases:\s*Record<string,\s*string>/g,
    "const aliases: Record<number, number>",
  );

  // -- String comparisons involving UUIDs → integer comparisons --
  // .id === "uuid-string" → .id === integerValue
  content = content.replace(
    /\.id\s*===\s*"([^"]+)"/g,
    (_m, uuid) => `.id === ${uuidToId(uuid)}`,
  );
  content = content.replace(
    /\.id\s*!==\s*"([^"]+)"/g,
    (_m, uuid) => `.id !== ${uuidToId(uuid)}`,
  );
  content = content.replace(
    /\.fromId\s*===\s*"([^"]+)"/g,
    (_m, uuid) => `.fromId === ${uuidToId(uuid)}`,
  );
  content = content.replace(
    /\.toId\s*===\s*"([^"]+)"/g,
    (_m, uuid) => `.toId === ${uuidToId(uuid)}`,
  );

  // -- Assignment of string to numeric field --
  // .id = "uuid-string" → .id = integerValue
  content = content.replace(
    /\.id\s*=\s*"([^"]+)"/g,
    (_m, uuid) => `.id = ${uuidToId(uuid)}`,
  );
  content = content.replace(
    /\.fromId\s*=\s*"([^"]+)"/g,
    (_m, uuid) => `.fromId = ${uuidToId(uuid)}`,
  );
  content = content.replace(
    /\.toId\s*=\s*"([^"]+)"/g,
    (_m, uuid) => `.toId = ${uuidToId(uuid)}`,
  );

  // -- Fix assertion strings --
  content = content.replace(/duplicate UUID/g, "duplicate neuron id");

  // -- Fix type imports --
  // Remove SynapseExport import if only used for forEach type annotation
  // Replace SynapseExport in forEach with Record<string, unknown>
  content = content.replace(
    /\(synapse:\s*SynapseExport\)/g,
    "(synapse: Record<string, unknown>)",
  );

  // -- Set<string> → Set<number> for neuron ID sets --
  content = content.replace(/Set<string>/g, (match, offset) => {
    // Check context - is this related to neuron UUIDs?
    const context = content.substring(
      Math.max(0, offset - 50),
      offset + match.length + 50,
    );
    if (context.match(/neuron|uuid|hidden|father|mother/i)) {
      return "Set<number>";
    }
    return match;
  });

  // -- Fix Map<string, ...> for neuron mapping --
  // Only for neuron-related maps
  content = content.replace(
    /neuronUUIDs/g,
    "neuronIds",
  );

  // -- Type: focusNeurons from string[] to number[] --
  // setForcedFocusNeurons parameter
  content = content.replace(
    /neuronUUIDs:\s*readonly\s*string\[\]/g,
    "neuronIds: readonly number[]",
  );

  // -- Remove unused SynapseExport import if it was only used for type annotation --
  // Check if SynapseExport is still used
  if (!content.includes("SynapseExport")) {
    // Remove the import line
    content = content.replace(
      /import\s+type\s*\{\s*SynapseExport\s*\}\s*from\s*"[^"]+"\s*;\n/g,
      "",
    );
  } else {
    // If SynapseExport is still referenced but we replaced some usages,
    // check if it's still needed
    const synapseExportCount = (content.match(/SynapseExport/g) || []).length;
    const importCount = (
      content.match(/import.*SynapseExport/g) || []
    ).length;
    if (synapseExportCount <= importCount) {
      content = content.replace(
        /import\s+type\s*\{\s*SynapseExport\s*\}\s*from\s*"[^"]+"\s*;\n/g,
        "",
      );
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
  console.log("Usage: revert-and-patch.ts <file1> ...");
  Deno.exit(1);
}

let totalChanged = 0;
let errors = 0;
for (const filePath of files) {
  try {
    if (patchFile(filePath)) {
      totalChanged++;
      console.log(`Updated: ${filePath}`);
    }
  } catch (e) {
    errors++;
    console.error(`Error: ${filePath}: ${e}`);
  }
}
console.log(`\nTotal files updated: ${totalChanged}, errors: ${errors}`);
