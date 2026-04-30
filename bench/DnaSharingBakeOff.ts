/**
 * DnaSharingBakeOff.ts - CLI harness entry point.
 *
 * Issue #2491 (parent #2490): Reproducible bake-off so each candidate
 * DNA-sharing primitive can be measured against the same baseline
 * (production cluster vs Europa island) on the same probe dataset.
 *
 * Loads two creature JSONs (recipient + donor) and a probe dataset by
 * URL or filesystem path, then runs the configured strategies under a
 * shared generation budget and seed. The bake-off result is printed as
 * a Markdown table on stdout so it can be pasted directly into a PR.
 *
 * Usage:
 *
 *   deno run --allow-read --allow-net --allow-env bench/DnaSharingBakeOff.ts
 *   deno run --allow-read --allow-net --allow-env bench/DnaSharingBakeOff.ts \
 *     --generations 200 --seed 7
 *
 * Inputs are resolved in this order:
 *
 *   PRODUCTION_URL   Path or URL to the recipient creature JSON. Falls back
 *                    to `test/breed/samples/mother-1.json`.
 *   EUROPA_URL       Path or URL to the donor creature JSON. Falls back to
 *                    `test/breed/samples/father-1.json`.
 *   PROBE_DATASET_URL Path or URL to the probe dataset. Falls back to a
 *                    small built-in XOR-style dataset so CI runs without
 *                    network access.
 *
 *   --generations N  Generation budget for every strategy. Default 1000.
 *   --seed N         RNG seed shared across strategies. Default 42.
 *
 * The probe dataset format is a JSON array of `{ input: number[],
 * output: number[] }` records. Inputs and outputs are coerced to
 * Float32Array before being fed to the harness.
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import {
  CompactModuleGraftStrategy,
  formatBakeOffMarkdown,
  KnobTuningStrategy,
  NoOpStrategy,
  runBakeOff,
} from "@transfer/mod.ts";

const DEFAULT_RECIPIENT_PATH = "test/breed/samples/mother-1.json";
const DEFAULT_DONOR_PATH = "test/breed/samples/father-1.json";

/**
 * Built-in probe dataset (XOR variants). Two inputs, one output — matches
 * the dimensions of the small `test/breed/samples/*.json` fixtures so the
 * harness runs end-to-end with NoOpStrategy without network access.
 */
const DEFAULT_PROBE: DataRecordInterface[] = [
  { input: new Float32Array([0, 0]), output: new Float32Array([0]) },
  { input: new Float32Array([0, 1]), output: new Float32Array([1]) },
  { input: new Float32Array([1, 0]), output: new Float32Array([1]) },
  { input: new Float32Array([1, 1]), output: new Float32Array([0]) },
];

/** Read a JSON document by URL (http/https) or filesystem path. */
async function readJson(source: string): Promise<unknown> {
  if (/^https?:\/\//i.test(source)) {
    const res = await fetch(source);
    if (!res.ok) {
      throw new Error(
        `Failed to fetch ${source}: ${res.status} ${res.statusText}`,
      );
    }
    return await res.json();
  }
  const text = await Deno.readTextFile(source);
  return JSON.parse(text);
}

/** Coerce raw JSON probe records into typed `DataRecordInterface[]`. */
function coerceProbe(raw: unknown): DataRecordInterface[] {
  if (!Array.isArray(raw)) {
    throw new Error("Probe dataset must be a JSON array of {input,output}");
  }
  return raw.map((row, i) => {
    if (
      typeof row !== "object" || row === null ||
      !Array.isArray((row as Record<string, unknown>).input) ||
      !Array.isArray((row as Record<string, unknown>).output)
    ) {
      throw new Error(`Probe record ${i} must have number[] input and output`);
    }
    const r = row as { input: number[]; output: number[] };
    return {
      input: Float32Array.from(r.input),
      output: Float32Array.from(r.output),
    };
  });
}

async function loadRecipient(): Promise<CreatureExport> {
  const src = Deno.env.get("PRODUCTION_URL") ?? DEFAULT_RECIPIENT_PATH;
  return await readJson(src) as CreatureExport;
}

async function loadDonor(): Promise<CreatureExport> {
  const src = Deno.env.get("EUROPA_URL") ?? DEFAULT_DONOR_PATH;
  return await readJson(src) as CreatureExport;
}

async function loadProbe(): Promise<DataRecordInterface[]> {
  const src = Deno.env.get("PROBE_DATASET_URL");
  if (!src) return DEFAULT_PROBE;
  return coerceProbe(await readJson(src));
}

/** Minimal `--key value` / `--key=value` parser — avoids a CLI dependency. */
function parseFlag(argv: string[], key: string, fallback: number): number {
  const flag = `--${key}`;
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === flag && i + 1 < argv.length) {
      return Number.parseInt(argv[i + 1], 10);
    }
    if (arg.startsWith(`${flag}=`)) {
      return Number.parseInt(arg.slice(flag.length + 1), 10);
    }
  }
  return fallback;
}

if (import.meta.main) {
  const generations = parseFlag(Deno.args, "generations", 1000);
  const seed = parseFlag(Deno.args, "seed", 42);
  // Issue #2493: small fixtures rarely have a dense >=6-neuron module, so the
  // bench takes a `--min-size` knob (default 2) to allow a meaningful row on
  // small fixtures. Production Europa donors (266 hidden neurons) use the
  // module's own default of 6 by passing `--min-size 6`.
  const minSize = parseFlag(Deno.args, "min-size", 2);

  const [recipient, donor, probe] = await Promise.all([
    loadRecipient(),
    loadDonor(),
    loadProbe(),
  ]);

  const rows = await runBakeOff({
    recipient,
    donor,
    probe,
    generations,
    seed,
    strategies: [
      new NoOpStrategy(),
      // Issue #2492: Knob-tuning is the cheapest primitive — pure config
      // tweak via the `aggressive` preset. Acts as the baseline the
      // structural primitives (e.g. CompactModuleGraft) must beat.
      new KnobTuningStrategy("aggressive"),
      new CompactModuleGraftStrategy({
        probe,
        minSize,
        densityFactor: 1.5,
      }),
    ],
  });

  console.log(
    `# DNA Sharing Bake-Off (generations=${generations}, seed=${seed})`,
  );
  console.log("");
  console.log(formatBakeOffMarkdown(rows));
}
