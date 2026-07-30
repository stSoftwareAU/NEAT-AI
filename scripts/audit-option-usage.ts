#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run --allow-env
/**
 * Option-usage scan harness for the #3505 option-removal audit (Issue #3518).
 *
 * Enumerates every NEAT-AI option key from `src/config/`, checks each one
 * against the consumer repositories, and emits a CSV/markdown inventory of
 * `key → consumers that set it → verdict candidate`.
 *
 * The script decides `IN USE` vs `not set` only. Deciding `QUALIFIES` vs
 * `KEEP (load-bearing default)` needs a human reading the default's code path —
 * that is the sibling slices' job.
 *
 * Two controls run before the sweep and abort it on failure, because a corrupt
 * inventory is far worse than no inventory: a false `not set` leads a sibling
 * slice to remove a load-bearing option.
 *
 *     deno run --allow-read --allow-write --allow-run --allow-env \
 *       scripts/audit-option-usage.ts --out-dir docs/audit/3505
 *
 * Exit codes: 0 clean, 1 a control failed or a key stayed UNKNOWN, 2 bad usage.
 */

import { enumerateOptionKeys, uniqueKeys } from "./lib/optionInventory.ts";
import {
  CodeSearchProbe,
  type ConsumerRepo,
  DEFAULT_CODE_SEARCH_INTERVAL_MS,
  detectLocalGrepTool,
  discoverConsumerRepos,
  LocalGrepProbe,
  RateLimiter,
} from "./lib/optionUsageProbes.ts";
import {
  type ControlSpec,
  evaluateControls,
  type KeyVerdict,
  ProbeCache,
  scanKeys,
} from "./lib/optionUsageScan.ts";
import {
  buildRows,
  summarise,
  toCsv,
  toMarkdown,
} from "./lib/optionUsageReport.ts";

/** Confirmed consumers: both declare `@stsoftware/neat-ai` in `deno.json`. */
const DEFAULT_CONSUMERS = ["stSoftwareAU/GRQ", "stSoftwareAU/NEAT-AI-Examples"];

const CONTROLS: ControlSpec = {
  positiveKey: "populationSize",
  negativeKey: "dnaSharingMode",
  repos: DEFAULT_CONSUMERS,
};

interface Cli {
  outDir: string;
  cachePath: string;
  cloneRoot: string;
  repoRoot: string;
  intervalMs: number;
  codeSearch: boolean;
  discover: boolean;
  controlsOnly: boolean;
}

const USAGE =
  `Usage: deno run --allow-read --allow-write --allow-run --allow-env \\
  scripts/audit-option-usage.ts [options]

  --out-dir DIR       Where to write the CSV/markdown inventory
                      (default: docs/audit/option-usage)
  --cache FILE        Probe cache; re-runs cost no search quota. Hidden by
                      default so it is never staged (default:
                      <out-dir>/.probe-cache.json)
  --clone-root DIR    Directory holding sibling clones (default: ..)
  --repo-root DIR     NEAT-AI checkout to enumerate keys from (default: .)
  --interval-ms N     Spacing between code-search requests (default: ${DEFAULT_CODE_SEARCH_INTERVAL_MS})
  --no-code-search    Local ripgrep only; skip 'gh search code' entirely
  --no-discover       Skip org consumer discovery; use the known consumers
  --controls-only     Run the two controls and stop
  --help              Show this message`;

function parseArgs(argv: string[]): Cli | null {
  const cli: Cli = {
    outDir: "docs/audit/option-usage",
    cachePath: "",
    cloneRoot: "..",
    repoRoot: ".",
    intervalMs: DEFAULT_CODE_SEARCH_INTERVAL_MS,
    codeSearch: true,
    discover: true,
    controlsOnly: false,
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const value = () => {
      const next = argv[++i];
      if (next === undefined) throw new Error(`${arg} requires a value`);
      return next;
    };
    switch (arg) {
      case "--out-dir":
        cli.outDir = value();
        break;
      case "--cache":
        cli.cachePath = value();
        break;
      case "--clone-root":
        cli.cloneRoot = value();
        break;
      case "--repo-root":
        cli.repoRoot = value();
        break;
      case "--interval-ms": {
        const parsed = Number(value());
        if (!Number.isFinite(parsed) || parsed < 0) {
          throw new Error("--interval-ms must be a non-negative number");
        }
        cli.intervalMs = parsed;
        break;
      }
      case "--no-code-search":
        cli.codeSearch = false;
        break;
      case "--no-discover":
        cli.discover = false;
        break;
      case "--controls-only":
        cli.controlsOnly = true;
        break;
      case "--help":
      case "-h":
        console.log(USAGE);
        return null;
      default:
        throw new Error(`unknown option: ${arg}`);
    }
  }

  if (!cli.cachePath) cli.cachePath = `${cli.outDir}/.probe-cache.json`;
  return cli;
}

async function dirExists(path: string): Promise<boolean> {
  try {
    return (await Deno.stat(path)).isDirectory;
  } catch {
    return false;
  }
}

/** Pair each consumer repo with its local clone, when one is checked out. */
async function resolveConsumers(
  repos: string[],
  cloneRoot: string,
): Promise<ConsumerRepo[]> {
  return await Promise.all(repos.map(async (repo) => {
    const clonePath = `${cloneRoot}/${repo.split("/")[1]}`;
    return await dirExists(clonePath) ? { repo, clonePath } : { repo };
  }));
}

async function main(): Promise<number> {
  let cli: Cli | null;
  try {
    cli = parseArgs(Deno.args);
  } catch (error) {
    console.error(`❌ ${(error as Error).message}\n\n${USAGE}`);
    return 2;
  }
  if (!cli) return 0;

  let repos = DEFAULT_CONSUMERS;
  if (cli.discover && cli.codeSearch) {
    const discovered = await discoverConsumerRepos();
    if (discovered.note) {
      console.error(
        `⚠️  consumer discovery failed (${discovered.note}); using known consumers`,
      );
    } else {
      repos = [...new Set([...DEFAULT_CONSUMERS, ...discovered.repos])].sort();
      console.log(
        `🔎 consumers declaring @stsoftware/neat-ai: ${repos.join(", ")}`,
      );
    }
  }

  const consumers = await resolveConsumers(repos, cli.cloneRoot);
  for (const consumer of consumers) {
    console.log(
      `   ${consumer.repo} — ${
        consumer.clonePath
          ? `local clone ${consumer.clonePath}`
          : "code search only"
      }`,
    );
  }

  const tool = await detectLocalGrepTool();
  console.log(`🔧 local search tool: ${tool}`);
  const localProbe = new LocalGrepProbe(tool);
  const searchProbe = cli.codeSearch
    ? new CodeSearchProbe({ limiter: new RateLimiter(cli.intervalMs) })
    : undefined;

  await Deno.mkdir(cli.outDir, { recursive: true });
  const cache = new ProbeCache(cli.cachePath);
  await cache.load();
  console.log(`💾 probe cache: ${cli.cachePath} (${cache.size} entries)`);

  // Controls first — a corrupt inventory is worse than no inventory.
  const controlVerdicts = await scanKeys(
    [CONTROLS.positiveKey, CONTROLS.negativeKey],
    consumers.filter((c) => CONTROLS.repos.includes(c.repo)),
    { localProbe, searchProbe, cache },
  );
  await cache.save();
  const failures = evaluateControls(controlVerdicts, CONTROLS);
  if (failures.length > 0) {
    for (const failure of failures) {
      console.error(
        `❌ ${failure.control} control (${failure.key}): ${failure.reason}`,
      );
    }
    console.error(
      "❌ Aborting before the sweep — search plumbing is not trustworthy.",
    );
    return 1;
  }
  console.log(
    `✅ controls passed: ${CONTROLS.positiveKey} IN USE in ${
      CONTROLS.repos.join(" + ")
    }, ${CONTROLS.negativeKey} not set`,
  );
  if (cli.controlsOnly) return 0;

  const inventory = await enumerateOptionKeys(cli.repoRoot);
  const keys = uniqueKeys(inventory);
  console.log(
    `📋 ${inventory.length} declarations, ${keys.length} distinct keys`,
  );

  let verdicts: KeyVerdict[] = [];
  try {
    verdicts = await scanKeys(keys, consumers, {
      localProbe,
      searchProbe,
      cache,
      onProgress: (done, total, verdict) => {
        if (done % 25 === 0 || verdict.status === "UNKNOWN") {
          console.log(
            `   [${done}/${total}] ${verdict.key} → ${verdict.status}`,
          );
        }
      },
    });
  } finally {
    await cache.save();
  }

  const rows = buildRows(inventory, verdicts);
  const summary = summarise(rows);
  const csvPath = `${cli.outDir}/option-usage.csv`;
  const mdPath = `${cli.outDir}/option-usage.md`;
  await Deno.writeTextFile(csvPath, toCsv(rows));
  await Deno.writeTextFile(
    mdPath,
    toMarkdown(rows, "NEAT-AI option-usage baseline inventory (#3505)"),
  );

  console.log(
    `\n📊 ${summary.total} rows — IN USE ${summary.inUse}, not set ${summary.notSet}, UNKNOWN ${summary.unknown}`,
  );
  console.log(`   ${csvPath}\n   ${mdPath}`);

  if (summary.unknown > 0) {
    console.error(
      `❌ ${summary.unknown} row(s) UNKNOWN — a partial sweep is not a clean baseline.`,
    );
    return 1;
  }
  return 0;
}

if (import.meta.main) Deno.exit(await main());
