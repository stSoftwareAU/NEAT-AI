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

/**
 * Files whose content decides what a run measures. Their hash is recorded so a
 * result names the code that produced it even when that code is not (yet) a
 * commit.
 */
const HARNESS_FILES = [
  "scripts/island_exchange_study.ts",
  "scripts/lib/islandExchangeStudy.ts",
  "scripts/lib/preSelectionAB.ts",
] as const;

/** SHA-256 over the harness files, in a fixed order, name and content. */
async function harnessSha256(): Promise<string> {
  const encoder = new TextEncoder();
  const contents = await Promise.all(
    HARNESS_FILES.map((file) => Deno.readFile(file)),
  );
  const parts: Uint8Array[] = [];
  HARNESS_FILES.forEach((file, i) => {
    parts.push(encoder.encode(`${file}\n`), contents[i], encoder.encode("\n"));
  });
  const joined = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const part of parts) {
    joined.set(part, at);
    at += part.length;
  }
  const digest = await crypto.subtle.digest("SHA-256", joined);
  return Array.from(
    new Uint8Array(digest),
    (b) => b.toString(16).padStart(2, "0"),
  )
    .join("");
}

/**
 * Whether `scripts/` or `src/` differ from `HEAD`. A recorded `commit` only
 * names the code that ran when this is false; otherwise `harnessSha256` is the
 * identity to check.
 */
async function dirtyTree(): Promise<boolean> {
  const output = await new Deno.Command("git", {
    args: ["status", "--porcelain", "--", "scripts", "src"],
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!output.success) {
    throw new Error(
      `git status failed: ${new TextDecoder().decode(output.stderr)}`,
    );
  }
  return new TextDecoder().decode(output.stdout).trim().length > 0;
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
  const dirty = await dirtyTree();
  const sourceSha256 = await harnessSha256();
  if (dirty && !args.includes("--allow-dirty")) {
    console.error(
      "scripts/ or src/ has uncommitted changes, so the recorded commit would " +
        "not name the code that runs. Commit first, or pass --allow-dirty to " +
        "record `dirty: true` alongside `sourceSha256`.",
    );
    Deno.exit(2);
  }

  console.info(
    `Island exchange study — Issue #4159, version ${version}, commit ${commit}${
      dirty ? " (dirty)" : ""
    }, harness sha256 ${sourceSha256}`,
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
      `${
        JSON.stringify(
          { version, commit, dirty, sourceSha256, ...study },
          null,
          2,
        )
      }\n`,
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
