/**
 * Report the per-depth gradient profile of a creature (Issue #3972).
 *
 * ```bash
 * deno run --allow-read --allow-write --allow-env --allow-ffi \
 *   scripts/gradientDepthReport.ts \
 *   --creature test/data/grq-23-forests-constants.json \
 *   --samples 64 --seed 42 --output docs/evidence/gradient-depth-grq.md
 * ```
 *
 * `--observations <file>` reads a real corpus — a JSON array of input rows, one
 * array of numbers per row. Without it the script synthesises seeded rows and
 * says so in the report, because a profile measured on synthetic observations
 * describes the topology's response to *that* distribution and nothing more.
 */

import { Creature } from "@creature";
import {
  type GradientDepthBucket,
  type GradientDepthProfile,
  probeGradientDepth,
} from "@propagate/GradientDepthProbe.ts";
import { createSeededRng } from "@utils/RandomNumberGenerator.ts";

/** Build `count` seeded input rows of `width` values in [-1, 1). */
export function syntheticObservations(
  width: number,
  count: number,
  seed: number,
): Float32Array[] {
  const rng = createSeededRng(seed);
  const rows: Float32Array[] = [];
  for (let i = 0; i < count; i++) {
    const row = new Float32Array(width);
    for (let j = 0; j < width; j++) row[j] = rng.random() * 2 - 1;
    rows.push(row);
  }
  return rows;
}

/** Read a corpus of input rows: a JSON array of arrays of finite numbers. */
export function parseObservations(
  text: string,
  width: number,
): Float32Array[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new RangeError("observations file must be a non-empty JSON array");
  }
  return parsed.map((row, index) => {
    if (!Array.isArray(row) || row.length !== width) {
      throw new RangeError(
        `observation ${index} must be an array of ${width} numbers`,
      );
    }
    const values = new Float32Array(width);
    for (let i = 0; i < width; i++) {
      const value = row[i];
      if (typeof value !== "number" || !Number.isFinite(value)) {
        throw new RangeError(
          `observation ${index} value ${i} is not a finite number`,
        );
      }
      values[i] = value;
    }
    return values;
  });
}

function formatBucket(bucket: GradientDepthBucket): string {
  const causes = Object.entries(bucket.zeroCauses)
    .filter(([, count]) => count > 0)
    .sort((a, b) => b[1] - a[1])
    .map(([cause, count]) => `${cause} ${count}`)
    .join(", ");
  return [
    bucket.depth,
    bucket.neurons,
    bucket.observations,
    (bucket.zeroFraction * 100).toFixed(1) + "%",
    bucket.medianAbsGradient.toExponential(2),
    bucket.p95AbsGradient.toExponential(2),
    bucket.maxAbsGradient.toExponential(2),
    bucket.signFlipComparisons === 0
      ? "n/a"
      : (bucket.signFlipRate * 100).toFixed(1) + "%",
    causes === "" ? "—" : causes,
  ].map(String).join(" | ");
}

/** Render a profile as a Markdown section. */
export function renderProfile(
  title: string,
  profile: GradientDepthProfile,
  provenance: string,
): string {
  const lines: string[] = [];
  lines.push(`## ${title}`, "");
  lines.push(
    `- observations: ${profile.samples} rows (${provenance})`,
    `- deepest layer: ${profile.maxDepth}`,
  );
  if (profile.serialChain !== undefined) {
    lines.push(
      `- serial chain: depth ${profile.serialChain.startDepth}–` +
        `${profile.serialChain.endDepth}, ` +
        `${profile.serialChain.members.length} neurons`,
    );
  } else {
    lines.push("- serial chain: none");
  }
  lines.push(
    "",
    "| depth | neurons | obs | zero | median \\|g\\| | p95 \\|g\\| | max \\|g\\| | sign flips | zero attribution |",
    "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
  );
  for (const bucket of profile.buckets) {
    lines.push(`| ${formatBucket(bucket)} |`);
  }
  if (profile.chainBucket !== undefined) {
    lines.push(
      "",
      "Restricted to the serial chain:",
      "",
      "| depth | neurons | obs | zero | median \\|g\\| | p95 \\|g\\| | max \\|g\\| | sign flips | zero attribution |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- |",
      `| ${formatBucket(profile.chainBucket)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

/** `--name value` pairs; an unknown flag is refused rather than ignored. */
export function parseFlags(
  argv: readonly string[],
  known: readonly string[],
): Map<string, string> {
  const flags = new Map<string, string>();
  for (let i = 0; i < argv.length; i += 2) {
    const flag = argv[i];
    if (!flag.startsWith("--")) {
      throw new RangeError(`expected a --flag, got "${flag}"`);
    }
    const name = flag.slice(2);
    if (!known.includes(name)) {
      throw new RangeError(`unknown flag "${flag}"`);
    }
    const value = argv[i + 1];
    if (value === undefined) {
      throw new RangeError(`flag "${flag}" needs a value`);
    }
    flags.set(name, value);
  }
  return flags;
}

if (import.meta.main) {
  const flags = parseFlags(Deno.args, [
    "creature",
    "observations",
    "output",
    "samples",
    "seed",
  ]);
  const creaturePath = flags.get("creature");
  if (creaturePath === undefined) {
    console.error("--creature <path> is required");
    Deno.exit(2);
  }

  const creature = Creature.fromJSON(
    JSON.parse(await Deno.readTextFile(creaturePath)),
  );

  const corpusPath = flags.get("observations");
  const seed = Number(flags.get("seed") ?? "42");
  let rows: Float32Array[];
  let provenance: string;
  if (corpusPath !== undefined) {
    rows = parseObservations(
      await Deno.readTextFile(corpusPath),
      creature.input,
    );
    provenance = `corpus ${corpusPath}`;
  } else {
    rows = syntheticObservations(
      creature.input,
      Number(flags.get("samples") ?? "64"),
      seed,
    );
    provenance =
      `SYNTHETIC seeded uniform[-1,1), seed ${seed} — not production data`;
  }

  const profile = probeGradientDepth(creature, rows);
  const report = renderProfile(creaturePath, profile, provenance);

  const outputPath = flags.get("output");
  if (outputPath !== undefined) {
    await Deno.writeTextFile(outputPath, report);
  } else {
    console.log(report);
  }
}
