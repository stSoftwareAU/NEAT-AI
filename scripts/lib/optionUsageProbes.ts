/**
 * Consumer-usage probes for the #3505 option-removal audit (Issue #3518).
 *
 * Two independent probes answer "does this consumer set this key?":
 *
 * - {@link LocalGrepProbe} greps a local clone. Complete and rate-limit free,
 *   so it is the primary evidence whenever a clone is available.
 * - {@link CodeSearchProbe} asks `gh search code` **per repo**. Never with a
 *   bare `--owner`: NEAT-AI's own hits saturate the org-wide result window and
 *   report load-bearing options such as `populationSize` as unused.
 *
 * Every probe distinguishes `miss` (searched, nothing found) from `unresolved`
 * (could not search). `unresolved` surfaces as `UNKNOWN` in the report rather
 * than being quietly folded into "not set".
 */

/** A repository that consumes NEAT-AI. */
export interface ConsumerRepo {
  /** `owner/name` as GitHub knows it. */
  repo: string;
  /** Path to a local clone, when one is available. */
  clonePath?: string;
}

/** Outcome of probing one key against one consumer. */
export type Resolution = "hit" | "miss" | "unresolved";

/** Result of a single probe run. */
export interface ProbeResult {
  resolution: Resolution;
  /** Paths that matched, capped for readability. */
  paths: string[];
  /** Why the probe could not resolve, or any other detail worth reporting. */
  note?: string;
}

/** A way of asking whether a consumer mentions a key. */
export interface KeyProbe {
  readonly name: string;
  probe(key: string, consumer: ConsumerRepo): Promise<ProbeResult>;
}

/** Output of an external command. */
export interface CommandOutput {
  code: number;
  stdout: string;
  stderr: string;
}

/** Injectable command runner, so probes are testable without a network. */
export type CommandRunner = (
  cmd: string,
  args: string[],
) => Promise<CommandOutput>;

const decoder = new TextDecoder();

/** Exit code used when the command could not be spawned at all. */
export const SPAWN_FAILED = 127;

/**
 * Real command runner backed by `Deno.Command`. A missing binary is reported
 * as {@link SPAWN_FAILED} rather than thrown, so a probe turns it into an
 * `unresolved` result instead of aborting the sweep mid-run.
 */
export const runCommand: CommandRunner = async (cmd, args) => {
  try {
    const output = await new Deno.Command(cmd, {
      args,
      stdout: "piped",
      stderr: "piped",
    }).output();
    return {
      code: output.code,
      stdout: decoder.decode(output.stdout),
      stderr: decoder.decode(output.stderr),
    };
  } catch (error) {
    return { code: SPAWN_FAILED, stdout: "", stderr: (error as Error).message };
  }
};

const MAX_REPORTED_PATHS = 5;

function nonEmptyLines(text: string): string[] {
  return text.split("\n").map((l) => l.trim()).filter((l) => l.length > 0);
}

/** Local search tools, in preference order. */
export type LocalGrepTool = "rg" | "git-grep";

/**
 * Pick the local search tool. `rg` is preferred; `git grep` is the fallback
 * because a consumer clone is always a git repository, whereas ripgrep is not
 * installed everywhere.
 */
export async function detectLocalGrepTool(
  run: CommandRunner = runCommand,
): Promise<LocalGrepTool> {
  const { code } = await run("rg", ["--version"]);
  return code === 0 ? "rg" : "git-grep";
}

/** Greps a local clone. Complete, and free of any search rate limit. */
export class LocalGrepProbe implements KeyProbe {
  readonly name: string;

  constructor(
    private readonly tool: LocalGrepTool = "rg",
    private readonly run: CommandRunner = runCommand,
  ) {
    this.name = `local-${tool}`;
  }

  private command(key: string, root: string): [string, string[]] {
    if (this.tool === "rg") {
      return ["rg", [
        "--fixed-strings",
        "--files-with-matches",
        "--no-messages",
        "--glob",
        "!.git",
        "--glob",
        "!node_modules",
        "--",
        key,
        root,
      ]];
    }
    // `--untracked` also covers files not yet committed in a working clone.
    return ["git", [
      "-C",
      root,
      "grep",
      "--fixed-strings",
      "--files-with-matches",
      "--untracked",
      "-e",
      key,
    ]];
  }

  async probe(key: string, consumer: ConsumerRepo): Promise<ProbeResult> {
    const root = consumer.clonePath;
    if (!root) {
      return {
        resolution: "unresolved",
        paths: [],
        note: "no local clone configured",
      };
    }
    const [cmd, args] = this.command(key, root);
    const { code, stdout, stderr } = await this.run(cmd, args);

    // Both tools: 0 = matches, 1 = no matches, >=2 = the search itself failed.
    if (code === 0) {
      const paths = nonEmptyLines(stdout).map((p) =>
        p.startsWith(root) ? p.slice(root.length).replace(/^\//, "") : p
      );
      return { resolution: "hit", paths: paths.slice(0, MAX_REPORTED_PATHS) };
    }
    if (code === 1) return { resolution: "miss", paths: [] };
    return {
      resolution: "unresolved",
      paths: [],
      note: `${cmd} exited ${code}: ${stderr.trim() || "unknown error"}`,
    };
  }
}

/** Pause helper, injectable so tests never really sleep. */
export type Sleeper = (ms: number) => Promise<void>;

export const realSleep: Sleeper = (ms) =>
  new Promise((resolve) => setTimeout(resolve, ms));

/** Spaces calls out to at most one per `intervalMs`. */
export class RateLimiter {
  private nextAt = 0;

  constructor(
    private readonly intervalMs: number,
    private readonly sleep: Sleeper = realSleep,
    private readonly now: () => number = () => performance.now(),
  ) {}

  async take(): Promise<void> {
    const wait = this.nextAt - this.now();
    if (wait > 0) await this.sleep(wait);
    this.nextAt = this.now() + this.intervalMs;
  }

  /** Push the next slot out by `ms` after a rate-limit rejection. */
  penalise(ms: number): void {
    this.nextAt = Math.max(this.nextAt, this.now() + ms);
  }
}

/** Options for {@link CodeSearchProbe}. */
export interface CodeSearchOptions {
  run?: CommandRunner;
  limiter?: RateLimiter;
  sleep?: Sleeper;
  /** Attempts per query before giving up and reporting `unresolved`. */
  maxAttempts?: number;
  /** First back-off pause after a 403/429; doubles each retry. */
  backoffMs?: number;
}

/**
 * The GitHub code-search endpoint allows 10 requests/minute for an
 * authenticated user, so queries are spaced ~6.5s apart by default.
 */
export const DEFAULT_CODE_SEARCH_INTERVAL_MS = 6_500;

function looksRateLimited(text: string): boolean {
  return /rate limit|secondary rate|403|429|abuse detection/i.test(text);
}

/** Asks `gh search code` for one key, scoped to exactly one repository. */
export class CodeSearchProbe implements KeyProbe {
  readonly name = "gh-code-search";
  private readonly run: CommandRunner;
  private readonly limiter: RateLimiter;
  private readonly sleep: Sleeper;
  private readonly maxAttempts: number;
  private readonly backoffMs: number;
  /** Count of queries that exhausted their retries, for run-level reporting. */
  rateLimitFailures = 0;

  constructor(options: CodeSearchOptions = {}) {
    this.run = options.run ?? runCommand;
    this.sleep = options.sleep ?? realSleep;
    this.limiter = options.limiter ??
      new RateLimiter(DEFAULT_CODE_SEARCH_INTERVAL_MS, this.sleep);
    this.maxAttempts = options.maxAttempts ?? 4;
    this.backoffMs = options.backoffMs ?? 30_000;
  }

  async probe(key: string, consumer: ConsumerRepo): Promise<ProbeResult> {
    let backoff = this.backoffMs;
    let lastNote = "no attempt made";

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      // Retries are inherently serial: each one must wait for the rate-limit
      // slot and the back-off from the attempt before it.
      // deno-lint-ignore no-await-in-loop
      await this.limiter.take();
      // deno-lint-ignore no-await-in-loop
      const { code, stdout, stderr } = await this.run("gh", [
        "search",
        "code",
        key,
        "--repo",
        consumer.repo,
        "--limit",
        "20",
        "--json",
        "path",
      ]);

      if (code === 0) {
        try {
          const parsed = JSON.parse(stdout || "[]") as { path?: string }[];
          const paths = parsed.map((r) => r.path ?? "").filter(Boolean);
          return paths.length > 0
            ? { resolution: "hit", paths: paths.slice(0, MAX_REPORTED_PATHS) }
            : { resolution: "miss", paths: [] };
        } catch (error) {
          lastNote = `unparseable gh output: ${(error as Error).message}`;
          break;
        }
      }

      lastNote = `gh exited ${code}: ${stderr.trim() || "unknown error"}`;
      if (!looksRateLimited(stderr)) break;
      if (attempt < this.maxAttempts) {
        // deno-lint-ignore no-await-in-loop
        await this.sleep(backoff);
        this.limiter.penalise(backoff);
        backoff *= 2;
      }
    }

    if (looksRateLimited(lastNote)) this.rateLimitFailures++;
    return { resolution: "unresolved", paths: [], note: lastNote };
  }
}

/**
 * Discover the org repositories that declare `@stsoftware/neat-ai` in a
 * `deno.json`. One code-search request replaces a per-repo org sweep, and the
 * filename filter keeps NEAT-AI's own source out of the result window.
 */
export async function discoverConsumerRepos(
  run: CommandRunner = runCommand,
  selfRepo = "stSoftwareAU/NEAT-AI",
): Promise<{ repos: string[]; note?: string }> {
  const { code, stdout, stderr } = await run("gh", [
    "search",
    "code",
    '"@stsoftware/neat-ai"',
    "--owner",
    "stSoftwareAU",
    "--filename",
    "deno.json",
    "--limit",
    "100",
    "--json",
    "repository",
  ]);
  if (code !== 0) {
    return {
      repos: [],
      note: `gh exited ${code}: ${stderr.trim() || "unknown error"}`,
    };
  }
  try {
    const parsed = JSON.parse(stdout || "[]") as {
      repository?: { nameWithOwner?: string };
    }[];
    const repos = [
      ...new Set(
        parsed
          .map((r) => r.repository?.nameWithOwner ?? "")
          .filter((n) => n.length > 0 && n !== selfRepo),
      ),
    ].sort();
    return { repos };
  } catch (error) {
    return {
      repos: [],
      note: `unparseable gh output: ${(error as Error).message}`,
    };
  }
}
