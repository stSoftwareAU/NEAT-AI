/**
 * Reads NDJSON lines from `scripts/profileEvolveDir.ts` and prints per-generation
 * wall time and phase splits (`fitnessMs`, `breedingMs`, `resultProcessingMs`).
 *
 * ```bash
 * deno run --allow-read scripts/summariseEvolveProfile.ts .hidden/evolve-profile.ndjson
 * ```
 */
const path = Deno.args[0];
if (!path) {
  console.error(
    "Usage: deno run --allow-read scripts/summariseEvolveProfile.ts <ndjson-file>",
  );
  Deno.exit(1);
}

const text = await Deno.readTextFile(path);
const rows: {
  generation: number;
  elapsedMs: number;
  fitnessMs?: number;
  breedingMs?: number;
  resultProcessingMs?: number;
  totalMs?: number;
}[] = [];

for (const line of text.split("\n")) {
  const s = line.trim();
  if (!s) continue;
  let o: Record<string, unknown>;
  try {
    o = JSON.parse(s) as Record<string, unknown>;
  } catch {
    continue;
  }
  if (o.kind !== "generation_complete") continue;
  const phase = o.phaseTiming as Record<string, number> | undefined;
  rows.push({
    generation: o.generation as number,
    elapsedMs: o.elapsedMs as number,
    fitnessMs: phase?.fitnessMs,
    breedingMs: phase?.breedingMs,
    resultProcessingMs: phase?.resultProcessingMs,
    totalMs: phase?.totalMs,
  });
}

if (rows.length === 0) {
  console.log("No generation_complete records found.");
  Deno.exit(0);
}

console.log(
  "gen\telapsedMs\tfitnessMs\tbreedingMs\tresultProcMs\ttotalMs(phase)",
);
for (const r of rows) {
  console.log(
    `${r.generation}\t${Math.round(r.elapsedMs)}\t` +
      `${r.fitnessMs ?? ""}\t${r.breedingMs ?? ""}\t` +
      `${r.resultProcessingMs ?? ""}\t${r.totalMs ?? ""}`,
  );
}

const sum = rows.reduce((a, r) => a + r.elapsedMs, 0);
const mean = sum / rows.length;
console.log(
  `\nGenerations: ${rows.length}; mean elapsedMs: ${mean.toFixed(0)}`,
);
