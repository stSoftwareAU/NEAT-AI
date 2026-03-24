#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env
/**
 * Smart fix v2: For each failing test file, try multiple approaches:
 *
 * 1. Pre-commit version as-is (works if no API changes needed)
 * 2. Pre-commit version with API patches (converts .uuid→.id etc.)
 * 3. HEAD version as-is (already passing or acceptable)
 *
 * Tests each approach by running individual test file.
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

function testFile(file: string): boolean {
  const result = new Deno.Command("deno", {
    args: ["test", "--allow-all", "--no-check", file],
    stdout: "piped",
    stderr: "piped",
    env: { ...Deno.env.toObject(), NO_COLOR: "1" },
  }).outputSync();
  return result.code === 0;
}

function applyApiPatches(content: string, isCrispr: boolean): string {
  // Method renames
  content = content.replace(/\bgetHiddenNeuronUUIDs\b/g, "getHiddenNeuronIds");
  content = content.replace(/\bbuildUuidToIndexMap\b/g, "buildIdToIndexMap");
  content = content.replace(
    /\bgetSuccessfulRemovalNeuronUUIDs\b/g,
    "getSuccessfulRemovalNeuronIds",
  );
  content = content.replace(/\bneuronUUIDs\b/g, "neuronIds");

  // Property access: .uuid → .id (NOT followed by : which would be JSON field)
  content = content.replace(/\.uuid\b(?!\s*:)/g, ".id");
  content = content.replace(/\.fromUUID\b(?!\s*:)/g, ".fromId");
  content = content.replace(/\.toUUID\b(?!\s*:)/g, ".toId");

  // CRISPR-specific: convert JSON data fields too
  if (isCrispr) {
    content = content.replace(
      /fromUUID:\s*"([^"]+)"/g,
      (_m, uuid) => `fromId: ${uuidToId(uuid)}`,
    );
    content = content.replace(
      /toUUID:\s*"([^"]+)"/g,
      (_m, uuid) => `toId: ${uuidToId(uuid)}`,
    );
    content = content.replace(
      /([\s,{])uuid:\s*"([^"]+)"/g,
      (_m, before, uuid) => {
        if (uuid.match(/^output-\d+$/)) return _m;
        return `${before}id: ${uuidToId(uuid)}`;
      },
    );
    content = content.replace(
      /Record<string,\s*string>/g,
      "Record<number, number>",
    );
  }

  // Fix string comparisons on numeric fields
  // .id === "uuid-string" → .id === correctIntId
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

  // Fix string assignment to numeric field
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

  // Fix bracket notation UUID access for memetic data
  content = content.replace(
    /\["((?:hidden-|constant-)[^"]+)"\]/g,
    (_m, uuid) => `[${deterministicIdFromUuid(uuid)}]`,
  );

  // Fix assertion strings
  content = content.replace(/duplicate UUID/g, "duplicate neuron id");

  // Fix SynapseExport type in forEach (no longer has fromUUID/toUUID as required)
  content = content.replace(
    /\(synapse:\s*SynapseExport\)/g,
    "(synapse: Record<string, unknown>)",
  );

  // Remove unused SynapseExport import
  const usages = (content.match(/SynapseExport/g) || []).length;
  const imports = (content.match(/import.*SynapseExport/g) || []).length;
  if (usages > 0 && usages === imports) {
    content = content.replace(
      /import\s+type\s*\{\s*SynapseExport\s*\}\s*from\s*"[^"]+"\s*;?\n?/g,
      "",
    );
  }

  return content;
}

const files = Deno.args.filter((a) => !a.startsWith("--"));
if (files.length === 0) {
  console.log("Usage: smart-fix-v2.ts <file1> ...");
  Deno.exit(1);
}

let fixedPreCommit = 0;
let fixedPatched = 0;
let fixedHead = 0;
let stillFailing = 0;
const failedFiles: string[] = [];

for (const filePath of files) {
  const headContent = Deno.readTextFileSync(filePath);
  const preContent = gitShow(parentCommit, filePath);
  const isCrispr = filePath.toLowerCase().includes("crispr");

  // Approach 1: Pre-commit as-is
  if (preContent) {
    Deno.writeTextFileSync(filePath, preContent);
    if (testFile(filePath)) {
      fixedPreCommit++;
      console.log(`FIXED (pre-commit): ${filePath}`);
      continue;
    }
  }

  // Approach 2: Pre-commit with API patches
  if (preContent) {
    const patched = applyApiPatches(preContent, isCrispr);
    Deno.writeTextFileSync(filePath, patched);
    if (testFile(filePath)) {
      fixedPatched++;
      console.log(`FIXED (patched): ${filePath}`);
      continue;
    }
  }

  // Approach 3: HEAD version
  Deno.writeTextFileSync(filePath, headContent);
  if (testFile(filePath)) {
    fixedHead++;
    console.log(`FIXED (HEAD): ${filePath}`);
    continue;
  }

  // Still failing - keep HEAD
  Deno.writeTextFileSync(filePath, headContent);
  stillFailing++;
  failedFiles.push(filePath);
  console.log(`STILL FAILING: ${filePath}`);
}

console.log(`\nResults:`);
console.log(`  Fixed (pre-commit): ${fixedPreCommit}`);
console.log(`  Fixed (patched):    ${fixedPatched}`);
console.log(`  Fixed (HEAD):       ${fixedHead}`);
console.log(`  Still failing:      ${stillFailing}`);

if (failedFiles.length > 0) {
  Deno.writeTextFileSync(
    "/tmp/still_need_manual_fix.txt",
    failedFiles.join("\n") + "\n",
  );
  console.log(`\nFailed file list: /tmp/still_need_manual_fix.txt`);
}
