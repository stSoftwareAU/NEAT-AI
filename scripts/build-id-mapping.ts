#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run

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

const parentCommit = "8e20a871~1";
const failingFiles = Deno.readTextFileSync("/tmp/failing_tests.txt")
  .trim().split("\n")
  .filter((f) => f.startsWith("test/"));

const allMappings: Record<string, Record<string, number>> = {};

for (const file of failingFiles) {
  try {
    const diffResult = new Deno.Command("git", {
      args: ["diff", parentCommit, "8e20a871", "--", file],
      stdout: "piped",
      stderr: "piped",
    }).outputSync();

    if (diffResult.code !== 0) continue;

    const diff = new TextDecoder().decode(diffResult.stdout);
    const diffLines = diff.split("\n");

    const mapping: Record<string, number> = {};
    const removedQueue: string[] = [];
    const addedQueue: number[] = [];

    for (const line of diffLines) {
      if (line.startsWith("-") && !line.startsWith("---")) {
        const m1 = line.match(/(?:uuid|fromUUID|toUUID):\s*"([^"]+)"/);
        const m2 = line.match(/\.uuid\s*===\s*"([^"]+)"/);
        if (m1) removedQueue.push(m1[1]);
        else if (m2) removedQueue.push(m2[1]);
      } else if (line.startsWith("+") && !line.startsWith("+++")) {
        const m1 = line.match(/(?:id|fromId|toId):\s*(-?[0-9]+)/);
        const m2 = line.match(/\.id\s*===\s*(-?[0-9]+)/);
        if (m1) addedQueue.push(parseInt(m1[1]));
        else if (m2) addedQueue.push(parseInt(m2[1]));
      } else {
        const minLen = Math.min(removedQueue.length, addedQueue.length);
        for (let i = 0; i < minLen; i++) {
          const uuid = removedQueue[i];
          const wrongId = addedQueue[i];
          const correctId = uuidToId(uuid);
          if (wrongId !== correctId) {
            mapping[String(wrongId)] = correctId;
          }
        }
        removedQueue.length = 0;
        addedQueue.length = 0;
      }
    }
    const minLen = Math.min(removedQueue.length, addedQueue.length);
    for (let i = 0; i < minLen; i++) {
      const uuid = removedQueue[i];
      const wrongId = addedQueue[i];
      const correctId = uuidToId(uuid);
      if (wrongId !== correctId) {
        mapping[String(wrongId)] = correctId;
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
  "/tmp/id_mappings_final.json",
  JSON.stringify(allMappings, null, 2),
);
console.log("Files with mappings: " + Object.keys(allMappings).length);
let total = 0;
for (const m of Object.values(allMappings)) total += Object.keys(m).length;
console.log("Total mappings: " + total);
