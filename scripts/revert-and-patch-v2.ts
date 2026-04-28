#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
/**
 * Revert-and-patch v2:
 * 1. Restore each test file to pre-commit state (legacy UUID format)
 * 2. Apply ONLY the minimal API changes needed
 *
 * KEY DISTINCTION:
 * - Creature JSON data: KEEP legacy format (uuid, fromUUID, toUUID)
 *   because Creature.fromJSON() supports it
 * - CRISPR JSON data: MUST convert to new format (id, fromId, toId)
 *   because CrisprInterface dropped legacy fields
 * - Property ACCESS on objects returned by code: convert to new names
 *   (.uuid → .id, .fromUUID → .fromId, .toUUID → .toId)
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
  const preContent = gitShow(parentCommit, filePath);
  if (!preContent) return false;

  let content = preContent;
  const isCrisprTest = filePath.toLowerCase().includes("crispr");

  // ===== Method renames =====
  content = content.replace(/\bgetHiddenNeuronUUIDs\b/g, "getHiddenNeuronIds");
  content = content.replace(/\bbuildUuidToIndexMap\b/g, "buildIdToIndexMap");
  content = content.replace(
    /\bgetSuccessfulRemovalNeuronUUIDs\b/g,
    "getSuccessfulRemovalNeuronIds",
  );

  // ===== Property access on OBJECTS (not JSON data) =====
  // These patterns match dot-access: something.uuid, something.fromUUID, something.toUUID
  // Dot-access indicates property access on an object, not JSON literal field
  content = content.replace(/\.uuid\b(?!\s*:)/g, ".id");
  content = content.replace(/\.fromUUID\b(?!\s*:)/g, ".fromId");
  content = content.replace(/\.toUUID\b(?!\s*:)/g, ".toId");

  // ===== CRISPR-specific: convert JSON data to new format =====
  if (isCrisprTest) {
    // In CRISPR test files, convert JSON literal fields
    content = content.replace(
      /fromUUID:\s*"([^"]+)"/g,
      (_m, uuid) => `fromId: ${uuidToId(uuid)}`,
    );
    content = content.replace(
      /toUUID:\s*"([^"]+)"/g,
      (_m, uuid) => `toId: ${uuidToId(uuid)}`,
    );
    // Convert neuron uuid: "X" in CRISPR JSON
    // Be careful: only convert when it's clearly a neuron uuid (preceded by whitespace/comma)
    content = content.replace(
      /([\s,{])uuid:\s*"([^"]+)"/g,
      (_m, before, uuid) => {
        if (uuid.match(/^output-\d+$/)) return _m; // output UUIDs are auto-derived
        return `${before}id: ${uuidToId(uuid)}`;
      },
    );
  }

  // ===== Type changes =====
  // Record<string, string> aliases → Record<number, number>
  content = content.replace(
    /Record<string,\s*string>\s*=\s*\{/g,
    (match) => {
      // Check context to see if it's alias-related
      return match.replace("Record<string, string>", "Record<number, number>");
    },
  );

  // Fix alias object keys from "string": "string" to [number]: number
  // This is tricky - only for alias maps passed to editAliases
  if (isCrisprTest) {
    content = content.replace(
      /Record<string,\s*string>/g,
      "Record<number, number>",
    );
  }

  // ===== String comparison fixes =====
  // .id === "uuid-string" (after .uuid → .id rename)
  content = content.replace(
    /\.id\s*===\s*"([^"]+)"/g,
    (_m, uuid) => `.id === ${uuidToId(uuid)}`,
  );
  content = content.replace(
    /\.id\s*!==\s*"([^"]+)"/g,
    (_m, uuid) => `.id !== ${uuidToId(uuid)}`,
  );
  // .fromId === "string" (after .fromUUID → .fromId rename)
  content = content.replace(
    /\.fromId\s*===\s*"([^"]+)"/g,
    (_m, uuid) => `.fromId === ${uuidToId(uuid)}`,
  );
  content = content.replace(
    /\.toId\s*===\s*"([^"]+)"/g,
    (_m, uuid) => `.toId === ${uuidToId(uuid)}`,
  );

  // ===== Assignment of UUID string to .id numeric field =====
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

  // ===== Fix assertion strings =====
  content = content.replace(/duplicate UUID/g, "duplicate neuron id");

  // ===== Fix SynapseExport type usage in forEach =====
  content = content.replace(
    /\(synapse:\s*SynapseExport\)/g,
    "(synapse: Record<string, unknown>)",
  );

  // ===== Remove unused SynapseExport import =====
  const synapseExportUsages = (content.match(/SynapseExport/g) || []).length;
  const synapseExportImports =
    (content.match(/import.*SynapseExport/g) || []).length;
  if (synapseExportUsages > 0 && synapseExportUsages === synapseExportImports) {
    // Only used in imports - remove
    content = content.replace(
      /import\s+type\s*\{\s*SynapseExport\s*\}\s*from\s*"[^"]+"\s*;?\n?/g,
      "",
    );
  }

  // ===== Set<string> → Set<number> for neuron UUID sets =====
  // Only when in neuron-related context
  content = content.replace(
    /((?:neuron|father|mother|hidden|uuid).*?)Set<string>/gi,
    "$1Set<number>",
  );

  // ===== neuronUUIDs variable name → neuronIds =====
  content = content.replace(/\bneuronUUIDs\b/g, "neuronIds");

  // ===== Fix exported JSON property access =====
  // When code accesses exported JSON properties like:
  // exported.synapses[0].fromUUID → exported.synapses[0].fromId
  // Already handled by the dot-access replacements above

  // ===== Fix bracket notation UUID access =====
  // ["hidden-1"] in contexts where it should be [deterministicId]
  // Only for neuron biases/weights maps (memetic data)
  content = content.replace(
    /\["((?:hidden-|constant-)[^"]+)"\]/g,
    (_m, uuid) => `[${deterministicIdFromUuid(uuid)}]`,
  );

  // Always write the pre-commit version (with patches applied)
  // even if no patches matched - the pre-commit version itself IS the fix
  const currentContent = Deno.readTextFileSync(filePath);
  if (content !== currentContent) {
    Deno.writeTextFileSync(filePath, content);
    return true;
  }
  return false;
}

const files = Deno.args.filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.log("Usage: revert-and-patch-v2.ts <file1> ...");
  Deno.exit(1);
}

let totalChanged = 0;
let errors = 0;
for (const filePath of files) {
  try {
    if (patchFile(filePath)) {
      totalChanged++;
    }
  } catch (e) {
    errors++;
    console.error(`Error: ${filePath}: ${e}`);
  }
}
console.log(`Total files updated: ${totalChanged}, errors: ${errors}`);
