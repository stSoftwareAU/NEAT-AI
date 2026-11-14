/**
 * Issue #4159 — neighbour-only island exchange against global champion
 * broadcast.
 *
 * Runs three arms (`none`, `ring`, `broadcast`) from identical starting
 * islands under an identical evaluation budget, and compares `ring` and `none`
 * against the broadcast control on paired held-out error. A **hypothesis
 * test**: a `no-benefit` or `worse` verdict is a valid result.
 *
 * ```bash
 * deno task island-exchange-study --seeds=20 --json=/tmp/island-exchange.json
 * # or
 * deno run --allow-read --allow-write --allow-env --allow-ffi --allow-run=git \
 *   scripts/island_exchange_study.ts --seeds=20 --json=/tmp/island-exchange.json
 * ```
 *
 * The corpus is synthetic and says so in the output: this measures the
 * exchange policy, not production-size creatures or the real fleet transport.
 *
 * A measurement harness, not a production code path: nothing under `src/`
 * imports it.
 */

import { intArg, stringArg } from "./lib/cliArgs.ts";
import {
  type ArmComparison,
  DEFAULT_ISLAND_SETTINGS,
  type IslandStudySettings,
  runStudy,
} from "./lib/islandExchangeStudy.ts";

async function gitCommit(): Promise<string> {
  const output = await new Deno.Command("git", {
    args: ["rev-parse", "HEAD"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `git rev-parse HEAD failed: ${new TextDecoder().decode(output.stderr)}`,
    );
  }
  return new TextDecoder().decode(output.stdout).trim();
}

function describe(c: ArmComparison): string {
  const i = c.interval;
  const range = i === undefined
    ? "n/a"
    : `mean ${i.mean.toExponential(3)}, 95% CI [${i.lower.toExponential(3)}, ${
      i.upper.toExponential(3)
    }]`;
  return `${c.arm} vs ${c.control}: ${c.verdict} (${range}; wins ${c.wins}/${c.n}; ` +
    `collapse ${c.armCollapseRate} vs ${c.controlCollapseRate}; bytes ratio ${
      c.bytesRatio.toFixed(3)
    })`;
}

if (import.meta.main) {
  const args = [...Deno.args];
  const seedCount = intArg(args, "seeds", 20);
  const settings: IslandStudySettings = {
    ...DEFAULT_ISLAND_SETTINGS,
    generations: intArg(
      args,
      "generations",
      DEFAULT_ISLAND_SETTINGS.generations,
    ),
    islands: intArg(args, "islands", DEFAULT_ISLAND_SETTINGS.islands),
    islandPopulation: intArg(
      args,
      "island-population",
      DEFAULT_ISLAND_SETTINGS.islandPopulation,
    ),
    cadence: intArg(args, "cadence", DEFAULT_ISLAND_SETTINGS.cadence),
  };
  const seeds = Array.from(
    { length: seedCount },
    (_, i) => DEFAULT_ISLAND_SETTINGS.seed + i,
  );
  const version = JSON.parse(await Deno.readTextFile("deno.json")).version;
  const commit = await gitCommit();

  console.info(
    `Island exchange study — Issue #4159, version ${version}, commit ${commit}`,
  );
  console.info(
    `Synthetic corpus: this measures the exchange policy, not production-size ` +
      `creatures or the real fleet transport. ${seeds.length} seeds, ` +
      `${settings.islands} islands x ${settings.islandPopulation}, ` +
      `${settings.generations} generations, cadence ${settings.cadence}.`,
  );

  const study = runStudy(settings, seeds, () => performance.now());

  console.info(
    "\n| arm | seeds | holdout MSE | improvement | collapse rate | inter-island | within-island | transfers | bytes | records |",
  );
  console.info("|---|---|---|---|---|---|---|---|---|---|");
  for (const s of study.summary) {
    console.info(
      `| ${s.arm} | ${s.seeds} | ${s.holdoutMse.toExponential(3)} | ${
        s.improvement.toExponential(3)
      } | ${s.collapseRate.toFixed(2)} | ${
        s.finalInterIslandDistance.toFixed(3)
      } | ${s.withinIslandDistance.toFixed(3)} | ${s.transfers.toFixed(1)} | ${
        s.bytes.toFixed(0)
      } | ${s.recordsCharged.toFixed(0)} |`,
    );
  }
  console.info("");
  console.info(describe(study.comparisons.ringVsBroadcast));
  console.info(describe(study.comparisons.noneVsBroadcast));
  console.info(
    `Coverage: ${study.coverage.completedRuns}/${study.coverage.plannedRuns} runs`,
  );

  const jsonPath = stringArg(args, "json");
  if (jsonPath !== undefined) {
    await Deno.writeTextFile(
      jsonPath,
      `${JSON.stringify({ version, commit, ...study }, null, 2)}\n`,
    );
    console.info(`Wrote ${jsonPath}`);
  }

  if (study.coverage.completedRuns < study.coverage.plannedRuns) {
    for (const f of study.failures) {
      console.error(`FAILED seed ${f.seed} arm ${f.arm}: ${f.message}`);
    }
    Deno.exit(1);
  }
}
