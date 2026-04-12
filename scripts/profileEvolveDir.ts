/**
 * Harness: run `Creature.evolveDir` against an on-disk binary dataset while
 * appending structured training events to an NDJSON log (and optional
 * `[Timing] checkpointWriteMs=…` when NEAT_PROFILE_CHECKPOINT=1).
 *
 * **Paths are never committed** — pass `--creature` / `--data`, or set env
 * `BENCH_CREATURE` and `BENCH_DATA` in your own shell or an untracked wrapper
 * script (e.g. under `.hidden/`, which is gitignored by `.*` in `.gitignore`).
 *
 * Example (from NEAT-AI repo root; replace paths locally):
 *
 * ```bash
 * export BENCH_CREATURE=/absolute/path/to/creature-export.json
 * export BENCH_DATA=/absolute/path/to/binary-training-data-directory
 * rm -f .hidden/evolve-profile.ndjson
 * NEAT_PROFILE_CHECKPOINT=1 deno run --no-prompt --unstable-worker-options \
 *   --allow-read --allow-write --allow-env --allow-net --allow-import --allow-ffi \
 *   scripts/profileEvolveDir.ts
 * ```
 *
 * Interpretation:
 * - generation_complete.phaseTiming: fitness vs breeding vs resultProcessing.
 * - Stdout checkpointWriteMs vs phaseTiming.totalMs: JSON checkpoint cost.
 * - discovery_complete lines: structural evolution / FFI time.
 */
import { ensureDirSync } from "@std/fs/ensure-dir";
import { dirname } from "@std/path/dirname";
import {
  Creature,
  type CreatureExport,
  type NeatOptions,
  type TrainingEvent,
} from "../mod.ts";

function parseArgv(): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
  for (let i = 0; i < Deno.args.length; i++) {
    const a = Deno.args[i];
    if (!a.startsWith("--")) continue;
    const eq = a.indexOf("=");
    if (eq >= 0) {
      out[a.slice(2, eq)] = a.slice(eq + 1);
      continue;
    }
    const key = a.slice(2);
    const next = Deno.args[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function usage(): void {
  console.error(`Usage:
  deno run --no-prompt --unstable-worker-options \\
    --allow-read --allow-write --allow-env --allow-net --allow-import --allow-ffi \\
    scripts/profileEvolveDir.ts \\
    [--creature=<creature-export.json>] [--data=<binary-training-data-dir>] \\
    [--out=.hidden/evolve-profile.ndjson] [--population-size=20] [--timeout=45] \\
    [--iterations=N] [--threads=N] [--training-sample-rate=0.1] [--sparse-ratio=0.05] \\
    [--no-checkpoint]

Paths (required — use flags and/or env; flags win if both set):
  --creature=   or env BENCH_CREATURE   (creature JSON export)
  --data=       or env BENCH_DATA        (directory of binary training files)

Optional env:
  NEAT_PROFILE_CHECKPOINT=1   Log checkpointWriteMs each generation (stdout)
`);
}

async function main(): Promise<void> {
  const argv = parseArgv();
  if (argv.help === true || argv.h === true) {
    usage();
    Deno.exit(0);
  }

  const creaturePath = typeof argv.creature === "string"
    ? argv.creature
    : Deno.env.get("BENCH_CREATURE");
  const dataDir = typeof argv.data === "string"
    ? argv.data
    : Deno.env.get("BENCH_DATA");
  if (!creaturePath || !dataDir) {
    usage();
    Deno.exit(1);
  }

  ensureDirSync(".hidden");

  const outPath = typeof argv.out === "string"
    ? argv.out
    : ".hidden/evolve-profile.ndjson";
  const outDir = dirname(outPath);
  if (outDir !== "." && outDir !== "") {
    ensureDirSync(outDir);
  }

  const populationSize = typeof argv["population-size"] === "string"
    ? Math.max(2, parseInt(argv["population-size"], 10) || 20)
    : 20;
  const timeoutMinutes = typeof argv.timeout === "string"
    ? Math.max(1, parseInt(argv.timeout, 10) || 45)
    : 45;
  const trainingSampleRate = typeof argv["training-sample-rate"] === "string"
    ? Number(argv["training-sample-rate"])
    : 0.1;
  const sparseRatio = typeof argv["sparse-ratio"] === "string"
    ? Number(argv["sparse-ratio"])
    : 0.05;

  const iterationsArg = argv.iterations;
  const iterations = typeof iterationsArg === "string"
    ? Math.max(1, parseInt(iterationsArg, 10) || 0)
    : undefined;

  const threadsArg = argv.threads;
  const threads = typeof threadsArg === "string"
    ? Math.max(0, parseInt(threadsArg, 10) || 0)
    : undefined;

  const noCheckpoint = argv["no-checkpoint"] === true;
  const creatureStore = typeof argv["creature-store"] === "string"
    ? argv["creature-store"]
    : ".hidden/profile-creatures";

  if (!noCheckpoint) {
    const storeDir = dirname(creatureStore);
    if (storeDir !== "." && storeDir !== "") {
      ensureDirSync(storeDir);
    }
  }

  const raw = await Deno.readTextFile(creaturePath);
  const creature = Creature.fromJSON(JSON.parse(raw) as CreatureExport);

  const options: NeatOptions = {
    populationSize,
    timeoutMinutes,
    log: 1,
    verbose: true,
    trainingSampleRate,
    sparseRatio,
    ...(iterations !== undefined ? { iterations } : {}),
    ...(threads !== undefined && threads > 0 ? { threads } : {}),
    checkpointEveryGeneration: !noCheckpoint,
    creatureStore: noCheckpoint ? undefined : creatureStore,
    discoveryCacheDir: ".hidden/discovery-cache",
    experimentStore: ".hidden/experiments",
    CRISPRs: [],
    onTrainingEvent: (event: TrainingEvent) => {
      const record: Record<string, unknown> = { ...event };
      if (event.kind === "generation_complete") {
        record.memory = Deno.memoryUsage();
      }
      Deno.writeTextFileSync(
        outPath,
        `${JSON.stringify(record)}\n`,
        { append: true, create: true },
      );
    },
  };

  console.error(`Profiling: creature=${creaturePath} data=${dataDir}`);
  console.error(
    `NDJSON -> ${outPath} (append); NEAT_PROFILE_CHECKPOINT=${
      Deno.env.get("NEAT_PROFILE_CHECKPOINT") ?? ""
    }`,
  );

  const result = await creature.evolveDir(dataDir, options);
  console.log(JSON.stringify(result, null, 1));
}

if (import.meta.main) {
  await main();
}
