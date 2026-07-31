import { assert, assertEquals, assertRejects, assertThrows } from "@std/assert";
import {
  enumerateOptionKeys,
  extractInterfaceKeys,
  listExportedInterfaces,
  stripCommentsAndStrings,
  uniqueKeys,
} from "../../scripts/lib/optionInventory.ts";
import {
  CodeSearchProbe,
  type CommandOutput,
  type CommandRunner,
  detectLocalGrepTool,
  discoverConsumerRepos,
  type KeyProbe,
  LocalGrepProbe,
  type ProbeResult,
  rankEvidencePaths,
  RateLimiter,
  runCommand,
  SPAWN_FAILED,
} from "../../scripts/lib/optionUsageProbes.ts";
import {
  evaluateControls,
  type KeyVerdict,
  ProbeCache,
  resolveConsumer,
  scanKeys,
  verdictForKey,
} from "../../scripts/lib/optionUsageScan.ts";
import {
  buildRows,
  summarise,
  toCsv,
  toMarkdown,
} from "../../scripts/lib/optionUsageReport.ts";

/**
 * Tests for the option-usage scan harness (Issue #3518), the enabling slice of
 * the #3505 option-removal audit. These exercise the real enumeration,
 * probe, verdict and reporting functions used by
 * `scripts/audit-option-usage.ts`.
 */

// ---------------------------------------------------------------- inventory

const SAMPLE_SOURCE = `
/**
 * A doc comment mentioning notAKey: number and a "quoted: thing".
 */
export interface SampleConfig {
  /** Simple field. */
  enabled?: boolean;
  // Line comment with decoy: string
  readonly weight: number;
  "quoted-key": string;
  nested: {
    innerOne: number;
    innerTwo: string;
  };
  union: "a" | "b" | "c";
  callback(value: number): void;
  conditional: Foo extends Bar ? Yes : No;
  trailing: string
}

export interface OtherConfig {
  only: number;
}

interface NotExported {
  hidden: number;
}
`;

Deno.test("stripCommentsAndStrings - blanks comment and string bodies, keeps offsets", () => {
  const source = `const a = "he//llo"; // tail\n/* block: x */ const b = 1;`;
  const clean = stripCommentsAndStrings(source);
  assertEquals(clean.length, source.length, "offsets must be preserved");
  assertEquals(clean.split("\n").length, 2, "newlines must be preserved");
  assert(!clean.includes("he//llo"), "string body must be blanked");
  assert(!clean.includes("block"), "block comment body must be blanked");
  assert(clean.includes("const a ="), "code outside literals is untouched");
  assert(clean.includes("const b = 1;"), "code after a block comment survives");
});

Deno.test("stripCommentsAndStrings - an escaped quote does not end the literal", () => {
  const clean = stripCommentsAndStrings(`const a = "x\\"y: z"; const b = 2;`);
  assert(
    clean.includes("const b = 2;"),
    "parser must not lose the rest of the file",
  );
});

Deno.test("extractInterfaceKeys - reads only the interface's own fields", () => {
  assertEquals(extractInterfaceKeys(SAMPLE_SOURCE, "SampleConfig"), [
    "enabled",
    "weight",
    "quoted-key",
    "nested",
    "union",
    "conditional",
    "trailing",
  ]);
});

Deno.test("extractInterfaceKeys - ignores decoys in comments, strings and nested types", () => {
  const keys = extractInterfaceKeys(SAMPLE_SOURCE, "SampleConfig");
  for (
    const decoy of ["notAKey", "decoy", "innerOne", "innerTwo", "Yes", "No"]
  ) {
    assert(!keys.includes(decoy), `${decoy} must not be reported as a key`);
  }
  assert(!keys.includes("callback"), "a method signature is not an option key");
  assert(!keys.includes("readonly"), "a modifier is not an option key");
});

Deno.test("extractInterfaceKeys - fails loud on a missing interface", () => {
  assertThrows(
    () => extractInterfaceKeys(SAMPLE_SOURCE, "NoSuchConfig"),
    Error,
    "not found",
  );
});

Deno.test("extractInterfaceKeys - fails loud on an unbalanced body", () => {
  assertThrows(
    () =>
      extractInterfaceKeys("export interface Broken { a: number;", "Broken"),
    Error,
    "unbalanced",
  );
});

Deno.test("listExportedInterfaces - reports exported interfaces only", () => {
  assertEquals(listExportedInterfaces(SAMPLE_SOURCE), [
    "SampleConfig",
    "OtherConfig",
  ]);
});

Deno.test("enumerateOptionKeys - pins the real NeatArguments top-level surface", async () => {
  const rows = await enumerateOptionKeys(".");
  const topLevel = rows.filter((r) => r.slice === "top-level");

  // Pinned so a config refactor that adds or removes a field without the
  // harness picking it up fails here rather than mid-audit. #3518 quotes 118,
  // which came from a grep that skipped `readonly mutation` — the parser saw
  // the real 119. #3558 then removed `ensembleDiversity`, leaving 118; #3556
  // then removed `discoveryReplayDiagnostics`, leaving 117.
  assertEquals(
    topLevel.length,
    117,
    "NeatArguments top-level key count changed",
  );
  assert(
    topLevel.every((r) => r.ownerFile === "src/config/NeatArguments.ts"),
    "every top-level key is owned by NeatArguments.ts",
  );
  for (
    const expected of [
      "populationSize",
      "dnaSharingMode",
      "mutation",
      "costName",
    ]
  ) {
    assert(
      topLevel.some((r) => r.key === expected),
      `${expected} must appear in the top-level slice`,
    );
  }
});

Deno.test("enumerateOptionKeys - covers the nested *Config.ts interfaces", async () => {
  const rows = await enumerateOptionKeys(".");
  const nested = rows.filter((r) => r.slice === "nested");

  assert(
    nested.length > 100,
    `expected the real nested surface, got ${nested.length}`,
  );
  assert(
    nested.every((r) => r.ownerFile.endsWith("Config.ts")),
    "nested keys come from *Config.ts files",
  );
  assert(
    nested.some((r) => r.owner === "NoveltyConfig" && r.key === "archiveLimit"),
    "NoveltyConfig.archiveLimit must be enumerated",
  );
  assert(
    rows.every((r) =>
      r.key.length > 0 && r.owner.length > 0 && r.ownerFile.length > 0
    ),
    "no row may have an empty field",
  );
  const seen = new Set(rows.map((r) => `${r.ownerFile}|${r.owner}|${r.key}`));
  assertEquals(seen.size, rows.length, "declaration sites must be unique");
});

Deno.test("enumerateOptionKeys - rejects a root without src/config", async () => {
  await assertRejects(() =>
    enumerateOptionKeys("./test/fixtures/no-such-root")
  );
});

Deno.test("uniqueKeys - dedupes and sorts the search work-list", () => {
  const keys = uniqueKeys([
    { slice: "nested", ownerFile: "b.ts", owner: "B", key: "enabled" },
    { slice: "top-level", ownerFile: "a.ts", owner: "A", key: "alpha" },
    { slice: "nested", ownerFile: "c.ts", owner: "C", key: "enabled" },
  ]);
  assertEquals(keys, ["alpha", "enabled"]);
});

// ------------------------------------------------------------------- probes

function fakeRunner(
  responses: CommandOutput[],
  calls: string[][] = [],
): { run: CommandRunner; calls: string[][] } {
  let index = 0;
  const run: CommandRunner = (cmd, args) => {
    calls.push([cmd, ...args]);
    const response = responses[Math.min(index, responses.length - 1)];
    index++;
    return Promise.resolve(response);
  };
  return { run, calls };
}

const OK = (stdout: string): CommandOutput => ({ code: 0, stdout, stderr: "" });

Deno.test("LocalGrepProbe - exit 0 is a hit with clone-relative paths", async () => {
  const { run } = fakeRunner([
    OK("/clones/GRQ/src/Learn.ts\n/clones/GRQ/worker/learn.sh\n"),
  ]);
  const result = await new LocalGrepProbe("rg", run).probe("populationSize", {
    repo: "stSoftwareAU/GRQ",
    clonePath: "/clones/GRQ",
  });
  assertEquals(result.resolution, "hit");
  assertEquals(result.paths, ["src/Learn.ts", "worker/learn.sh"]);
});

Deno.test("LocalGrepProbe - exit 1 is a genuine miss", async () => {
  const { run } = fakeRunner([{ code: 1, stdout: "", stderr: "" }]);
  const result = await new LocalGrepProbe("rg", run).probe("dnaSharingMode", {
    repo: "stSoftwareAU/GRQ",
    clonePath: "/clones/GRQ",
  });
  assertEquals(result.resolution, "miss");
});

Deno.test("LocalGrepProbe - a search error is unresolved, never a miss", async () => {
  const { run } = fakeRunner([{ code: 2, stdout: "", stderr: "rg: boom" }]);
  const result = await new LocalGrepProbe("rg", run).probe("populationSize", {
    repo: "stSoftwareAU/GRQ",
    clonePath: "/clones/GRQ",
  });
  assertEquals(result.resolution, "unresolved");
  assert(result.note?.includes("rg: boom"));
});

Deno.test("LocalGrepProbe - no clone is unresolved, never a miss", async () => {
  const { run } = fakeRunner([OK("")]);
  const result = await new LocalGrepProbe("rg", run).probe("populationSize", {
    repo: "stSoftwareAU/GRQ",
  });
  assertEquals(result.resolution, "unresolved");
});

Deno.test("LocalGrepProbe - the git-grep fallback searches inside the clone", async () => {
  const { run, calls } = fakeRunner([OK("src/Learn.ts\n")]);
  const probe = new LocalGrepProbe("git-grep", run);

  const result = await probe.probe("populationSize", {
    repo: "stSoftwareAU/GRQ",
    clonePath: "/clones/GRQ",
  });

  assertEquals(probe.name, "local-git-grep");
  assertEquals(result.paths, ["src/Learn.ts"]);
  assertEquals(calls[0].slice(0, 4), ["git", "-C", "/clones/GRQ", "grep"]);
});

Deno.test("rankEvidencePaths - call sites outrank documentation mentions", () => {
  assertEquals(
    rankEvidencePaths([
      "CHANGELOG.md",
      "docs/archive/pr-summaries/pr-summary-1.md",
      "src/Learn.ts",
      "docs/evidence/run.log",
      "test/Worker.ts",
    ]),
    [
      "src/Learn.ts",
      "test/Worker.ts",
      "CHANGELOG.md",
      "docs/archive/pr-summaries/pr-summary-1.md",
      "docs/evidence/run.log",
    ],
  );
});

Deno.test("LocalGrepProbe - reports at most five paths, call sites first", async () => {
  const { run } = fakeRunner([
    OK([
      "/c/CHANGELOG.md",
      "/c/docs/a.md",
      "/c/docs/b.md",
      "/c/docs/c.md",
      "/c/docs/d.md",
      "/c/src/Learn.ts",
    ].join("\n")),
  ]);
  const result = await new LocalGrepProbe("rg", run).probe("populationSize", {
    repo: "stSoftwareAU/GRQ",
    clonePath: "/c",
  });

  assertEquals(result.paths.length, 5);
  assertEquals(
    result.paths[0],
    "src/Learn.ts",
    "the call site must survive truncation",
  );
});

Deno.test("detectLocalGrepTool - falls back to git grep when rg is absent", async () => {
  const present = fakeRunner([OK("ripgrep 14.0.0")]);
  assertEquals(await detectLocalGrepTool(present.run), "rg");

  const absent = fakeRunner([{
    code: SPAWN_FAILED,
    stdout: "",
    stderr: "not found",
  }]);
  assertEquals(await detectLocalGrepTool(absent.run), "git-grep");
});

Deno.test("runCommand - a missing binary is reported, not thrown", async () => {
  const result = await runCommand("no-such-binary-3518", ["--version"]);
  assertEquals(result.code, SPAWN_FAILED);
  assert(result.stderr.length > 0, "the spawn failure must be surfaced");
});

const NO_SLEEP = () => Promise.resolve();

function codeSearchProbe(responses: CommandOutput[]) {
  const { run, calls } = fakeRunner(responses);
  const probe = new CodeSearchProbe({
    run,
    sleep: NO_SLEEP,
    limiter: new RateLimiter(0, NO_SLEEP),
    backoffMs: 1,
  });
  return { probe, calls };
}

Deno.test("CodeSearchProbe - always scopes the query to a single repo", async () => {
  const { probe, calls } = codeSearchProbe([
    OK('[{"path":"src/fx/EvolveApp.ts"}]'),
  ]);
  const result = await probe.probe("populationSize", {
    repo: "stSoftwareAU/GRQ",
  });

  assertEquals(result.resolution, "hit");
  assertEquals(result.paths, ["src/fx/EvolveApp.ts"]);
  const args = calls[0];
  assert(args.includes("--repo"), "the query must be repo-scoped");
  assertEquals(args[args.indexOf("--repo") + 1], "stSoftwareAU/GRQ");
  assert(
    !args.includes("--owner"),
    "a bare --owner search saturates on NEAT-AI's own hits (#3518)",
  );
});

Deno.test("CodeSearchProbe - an empty result set is a miss", async () => {
  const { probe } = codeSearchProbe([OK("[]")]);
  assertEquals(
    (await probe.probe("dnaSharingMode", { repo: "stSoftwareAU/GRQ" }))
      .resolution,
    "miss",
  );
});

Deno.test("CodeSearchProbe - backs off and retries a 403, then succeeds", async () => {
  const { probe, calls } = codeSearchProbe([
    { code: 1, stdout: "", stderr: "HTTP 403: API rate limit exceeded" },
    { code: 1, stdout: "", stderr: "HTTP 403: API rate limit exceeded" },
    OK('[{"path":"src/Learn.ts"}]'),
  ]);
  const result = await probe.probe("populationSize", {
    repo: "stSoftwareAU/GRQ",
  });

  assertEquals(result.resolution, "hit", "a retried key must not be dropped");
  assertEquals(calls.length, 3, "both 403s must be retried");
  assertEquals(probe.rateLimitFailures, 0);
});

Deno.test("CodeSearchProbe - exhausted retries are unresolved, never a miss", async () => {
  const { probe, calls } = codeSearchProbe([
    { code: 1, stdout: "", stderr: "HTTP 403: secondary rate limit" },
  ]);
  const result = await probe.probe("populationSize", {
    repo: "stSoftwareAU/GRQ",
  });

  assertEquals(result.resolution, "unresolved");
  assertEquals(calls.length, 4, "maxAttempts attempts before giving up");
  assertEquals(probe.rateLimitFailures, 1);
});

Deno.test("CodeSearchProbe - a non-rate-limit failure is not retried", async () => {
  const { probe, calls } = codeSearchProbe([
    { code: 4, stdout: "", stderr: "gh: authentication required" },
  ]);
  const result = await probe.probe("populationSize", {
    repo: "stSoftwareAU/GRQ",
  });

  assertEquals(result.resolution, "unresolved");
  assertEquals(calls.length, 1);
});

Deno.test("CodeSearchProbe - unparseable output is unresolved", async () => {
  const { probe } = codeSearchProbe([OK("not json")]);
  assertEquals(
    (await probe.probe("populationSize", { repo: "stSoftwareAU/GRQ" }))
      .resolution,
    "unresolved",
  );
});

Deno.test("RateLimiter - spaces successive takes by the interval", async () => {
  const slept: number[] = [];
  let clock = 0;
  const limiter = new RateLimiter(
    1000,
    (ms) => {
      slept.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    () => clock,
  );

  await limiter.take();
  await limiter.take();
  await limiter.take();

  assertEquals(slept, [1000, 1000], "the first take is free, later ones wait");
});

Deno.test("RateLimiter - penalise pushes the next slot further out", async () => {
  const slept: number[] = [];
  let clock = 0;
  const limiter = new RateLimiter(
    100,
    (ms) => {
      slept.push(ms);
      clock += ms;
      return Promise.resolve();
    },
    () => clock,
  );

  await limiter.take();
  limiter.penalise(5000);
  await limiter.take();

  assertEquals(slept, [5000]);
});

Deno.test("discoverConsumerRepos - lists org consumers, excluding NEAT-AI itself", async () => {
  const { run, calls } = fakeRunner([
    OK(JSON.stringify([
      { repository: { nameWithOwner: "stSoftwareAU/GRQ" } },
      { repository: { nameWithOwner: "stSoftwareAU/NEAT-AI" } },
      { repository: { nameWithOwner: "stSoftwareAU/NEAT-AI-Examples" } },
      { repository: { nameWithOwner: "stSoftwareAU/GRQ" } },
    ])),
  ]);
  const found = await discoverConsumerRepos(run);

  assertEquals(found.repos, [
    "stSoftwareAU/GRQ",
    "stSoftwareAU/NEAT-AI-Examples",
  ]);
  assertEquals(found.note, undefined);
  assert(
    calls[0].includes("deno.json"),
    "discovery filters on the manifest filename",
  );
});

Deno.test("discoverConsumerRepos - a failure reports a note instead of an empty sweep", async () => {
  const { run } = fakeRunner([{ code: 1, stdout: "", stderr: "HTTP 403" }]);
  const found = await discoverConsumerRepos(run);
  assertEquals(found.repos, []);
  assert(
    found.note?.includes("403"),
    "the failure must be surfaced, not swallowed",
  );
});

// ------------------------------------------------------------------ verdicts

const hit = (paths: string[]): ProbeResult => ({ resolution: "hit", paths });
const miss = (): ProbeResult => ({ resolution: "miss", paths: [] });
const unresolved = (note: string): ProbeResult => ({
  resolution: "unresolved",
  paths: [],
  note,
});

Deno.test("resolveConsumer - any probe hit makes the consumer IN USE", () => {
  const verdict = resolveConsumer("stSoftwareAU/GRQ", [
    { probe: "local-rg", result: miss() },
    { probe: "gh-code-search", result: hit(["src/Learn.ts"]) },
  ]);
  assertEquals(verdict.status, "IN USE");
  assertEquals(verdict.evidence, ["gh-code-search:src/Learn.ts"]);
});

Deno.test("resolveConsumer - a resolved miss beside an unresolved probe is not set", () => {
  const verdict = resolveConsumer("stSoftwareAU/GRQ", [
    { probe: "local-rg", result: miss() },
    { probe: "gh-code-search", result: unresolved("HTTP 403") },
  ]);
  assertEquals(verdict.status, "not set", "one probe genuinely searched");
  assert(
    verdict.notes.some((n) => n.includes("403")),
    "the failure stays visible",
  );
});

Deno.test("resolveConsumer - no probe resolving is UNKNOWN, never not set", () => {
  const verdict = resolveConsumer("stSoftwareAU/GRQ", [
    { probe: "local-rg", result: unresolved("no local clone configured") },
    { probe: "gh-code-search", result: unresolved("HTTP 403") },
  ]);
  assertEquals(verdict.status, "UNKNOWN");
  assertEquals(verdict.notes.length, 2);
});

Deno.test("verdictForKey - IN USE when any consumer sets the key", () => {
  const verdict = verdictForKey("populationSize", [
    { repo: "a", status: "IN USE", evidence: ["local-rg:x.ts"], notes: [] },
    { repo: "b", status: "not set", evidence: [], notes: [] },
  ]);
  assertEquals(verdict.status, "IN USE");
  assertEquals(verdict.setBy, ["a"]);
});

Deno.test("verdictForKey - not set only when every consumer resolved to a miss", () => {
  const verdict = verdictForKey("dnaSharingMode", [
    { repo: "a", status: "not set", evidence: [], notes: [] },
    { repo: "b", status: "not set", evidence: [], notes: [] },
  ]);
  assertEquals(verdict.status, "not set");
  assertEquals(verdict.setBy, []);
});

Deno.test("verdictForKey - one UNKNOWN consumer poisons the key verdict", () => {
  const verdict = verdictForKey("someKey", [
    { repo: "a", status: "not set", evidence: [], notes: [] },
    { repo: "b", status: "UNKNOWN", evidence: [], notes: ["HTTP 403"] },
  ]);
  assertEquals(
    verdict.status,
    "UNKNOWN",
    "a partial sweep must not read as not set",
  );
});

Deno.test("verdictForKey - no consumers configured is UNKNOWN", () => {
  assertEquals(verdictForKey("someKey", []).status, "UNKNOWN");
});

// -------------------------------------------------------------------- scan

/** Probe returning canned results keyed by `repo|key`. */
class TableProbe implements KeyProbe {
  calls: string[] = [];
  constructor(
    readonly name: string,
    private readonly table: Record<string, ProbeResult>,
    private readonly fallback: ProbeResult = { resolution: "miss", paths: [] },
  ) {}
  probe(key: string, consumer: { repo: string }): Promise<ProbeResult> {
    this.calls.push(`${consumer.repo}|${key}`);
    return Promise.resolve(
      this.table[`${consumer.repo}|${key}`] ?? this.fallback,
    );
  }
}

const CONSUMERS = [
  { repo: "stSoftwareAU/GRQ", clonePath: "/clones/GRQ" },
  {
    repo: "stSoftwareAU/NEAT-AI-Examples",
    clonePath: "/clones/NEAT-AI-Examples",
  },
];

Deno.test("scanKeys - spends code-search quota only where local found nothing", async () => {
  const local = new TableProbe("local-rg", {
    "stSoftwareAU/GRQ|populationSize": hit(["src/Learn.ts"]),
    "stSoftwareAU/NEAT-AI-Examples|populationSize": hit(["xor.ts"]),
  });
  const search = new TableProbe("gh-code-search", {});

  const verdicts = await scanKeys(
    ["populationSize", "dnaSharingMode"],
    CONSUMERS,
    {
      localProbe: local,
      searchProbe: search,
    },
  );

  assertEquals(verdicts[0].status, "IN USE");
  assertEquals(verdicts[1].status, "not set");
  assertEquals(
    search.calls.sort(),
    [
      "stSoftwareAU/GRQ|dnaSharingMode",
      "stSoftwareAU/NEAT-AI-Examples|dnaSharingMode",
    ],
    "local hits must not consume the rate-limited quota",
  );
});

Deno.test("scanKeys - a code-search hit rescues a local miss", async () => {
  const local = new TableProbe("local-rg", {});
  const search = new TableProbe("gh-code-search", {
    "stSoftwareAU/GRQ|lateKey": hit(["src/New.ts"]),
  });

  const [verdict] = await scanKeys(["lateKey"], CONSUMERS, {
    localProbe: local,
    searchProbe: search,
  });

  assertEquals(verdict.status, "IN USE");
  assertEquals(verdict.setBy, ["stSoftwareAU/GRQ"]);
});

Deno.test("scanKeys - reports progress for every key", async () => {
  const seen: string[] = [];
  await scanKeys(["a", "b", "c"], CONSUMERS, {
    localProbe: new TableProbe("local-rg", {}),
    onProgress: (done, total, verdict) =>
      seen.push(`${done}/${total}:${verdict.key}`),
  });
  assertEquals(seen, ["1/3:a", "2/3:b", "3/3:c"]);
});

Deno.test("ProbeCache - a cached result replaces the probe call", async () => {
  const cache = new ProbeCache();
  cache.set(
    "local-rg",
    "stSoftwareAU/GRQ",
    "populationSize",
    hit(["src/Learn.ts"]),
  );
  const local = new TableProbe("local-rg", {});

  const [verdict] = await scanKeys(["populationSize"], [CONSUMERS[0]], {
    localProbe: local,
    cache,
  });

  assertEquals(verdict.status, "IN USE");
  assertEquals(local.calls, [], "a cache hit must not re-run the probe");
});

Deno.test("ProbeCache - never caches an unresolved probe", () => {
  const cache = new ProbeCache();
  cache.set("gh-code-search", "stSoftwareAU/GRQ", "k", unresolved("HTTP 403"));
  assertEquals(cache.size, 0, "a rate-limited probe must be retried next run");
  assertEquals(cache.get("gh-code-search", "stSoftwareAU/GRQ", "k"), undefined);
});

Deno.test("ProbeCache - round-trips through disk", async () => {
  const path = await Deno.makeTempFile({ suffix: ".json" });
  try {
    const writer = new ProbeCache(path);
    writer.set(
      "local-rg",
      "stSoftwareAU/GRQ",
      "populationSize",
      hit(["src/Learn.ts"]),
    );
    await writer.save();

    const reader = new ProbeCache(path);
    await reader.load();
    assertEquals(
      reader.get("local-rg", "stSoftwareAU/GRQ", "populationSize"),
      hit(["src/Learn.ts"]),
    );
  } finally {
    await Deno.remove(path);
  }
});

Deno.test("ProbeCache - a missing file is fine, a corrupt one is loud", async () => {
  const absent = new ProbeCache("/tmp/no-such-audit-cache-3518.json");
  await absent.load();
  assertEquals(absent.size, 0);

  const path = await Deno.makeTempFile({ suffix: ".json" });
  try {
    await Deno.writeTextFile(path, "{ not json");
    await assertRejects(() => new ProbeCache(path).load());
  } finally {
    await Deno.remove(path);
  }
});

// ---------------------------------------------------------------- controls

const CONTROL_SPEC = {
  positiveKey: "populationSize",
  negativeKey: "dnaSharingMode",
  repos: ["stSoftwareAU/GRQ", "stSoftwareAU/NEAT-AI-Examples"],
};

function controlVerdicts(
  positive: "IN USE" | "not set" | "UNKNOWN",
  negative: "IN USE" | "not set" | "UNKNOWN",
): KeyVerdict[] {
  const consumers = (status: "IN USE" | "not set" | "UNKNOWN") =>
    CONTROL_SPEC.repos.map((repo) => ({
      repo,
      status,
      evidence: [],
      notes: [],
    }));
  return [
    verdictForKey(CONTROL_SPEC.positiveKey, consumers(positive)),
    verdictForKey(CONTROL_SPEC.negativeKey, consumers(negative)),
  ];
}

Deno.test("evaluateControls - passes when both controls behave", () => {
  assertEquals(
    evaluateControls(controlVerdicts("IN USE", "not set"), CONTROL_SPEC),
    [],
  );
});

Deno.test("evaluateControls - fails when the positive control flips to not set", () => {
  // This is the --owner saturation trap reappearing, or a stale cache.
  const failures = evaluateControls(
    controlVerdicts("not set", "not set"),
    CONTROL_SPEC,
  );
  assertEquals(failures.length, 2, "one failure per consumer");
  assert(failures.every((f) => f.control === "positive"));
  assert(failures[0].reason.includes("expected IN USE"));
});

Deno.test("evaluateControls - fails when the negative control reports usage", () => {
  const failures = evaluateControls(
    controlVerdicts("IN USE", "IN USE"),
    CONTROL_SPEC,
  );
  assertEquals(failures.length, 2);
  assert(failures.every((f) => f.control === "negative"));
});

Deno.test("evaluateControls - fails when a control was never scanned", () => {
  const failures = evaluateControls([], CONTROL_SPEC);
  assertEquals(failures.map((f) => f.control), ["positive", "negative"]);
  assert(failures.every((f) => f.reason.includes("not scanned")));
});

// ------------------------------------------------------------------ report

const INVENTORY = [
  {
    slice: "top-level" as const,
    ownerFile: "src/config/NeatArguments.ts",
    owner: "NeatArguments",
    key: "populationSize",
  },
  {
    slice: "top-level" as const,
    ownerFile: "src/config/NeatArguments.ts",
    owner: "NeatArguments",
    key: "dnaSharingMode",
  },
  {
    slice: "nested" as const,
    ownerFile: "src/config/NoveltyConfig.ts",
    owner: "NoveltyConfig",
    key: "archiveLimit",
  },
];

const VERDICTS: KeyVerdict[] = [
  verdictForKey("populationSize", [{
    repo: "stSoftwareAU/GRQ",
    status: "IN USE",
    evidence: ["local-rg:src/Learn.ts"],
    notes: [],
  }]),
  verdictForKey("dnaSharingMode", [{
    repo: "stSoftwareAU/GRQ",
    status: "not set",
    evidence: [],
    notes: [],
  }]),
  verdictForKey("archiveLimit", [{
    repo: "stSoftwareAU/GRQ",
    status: "UNKNOWN",
    evidence: [],
    notes: ["gh-code-search: HTTP 403"],
  }]),
];

Deno.test("buildRows - maps each declaration to its verdict", () => {
  const rows = buildRows(INVENTORY, VERDICTS);
  assertEquals(rows.length, 3);
  assertEquals(rows[0].status, "IN USE");
  assertEquals(rows[0].setBy, ["stSoftwareAU/GRQ"]);
  assert(rows[0].verdictCandidate.startsWith("KEEP"));
  assert(rows[1].verdictCandidate.startsWith("REVIEW DEFAULT"));
  assert(rows[2].verdictCandidate.startsWith("UNKNOWN"));
  assert(rows[2].detail.includes("403"), "an UNKNOWN row must explain itself");
});

Deno.test("buildRows - an unscanned key is UNKNOWN, never silently dropped", () => {
  const rows = buildRows(INVENTORY, []);
  assertEquals(rows.length, INVENTORY.length, "no key may be omitted");
  assert(rows.every((r) => r.status === "UNKNOWN"));
  assert(rows.every((r) => r.detail === "key was never scanned"));
});

Deno.test("summarise - counts each status", () => {
  assertEquals(summarise(buildRows(INVENTORY, VERDICTS)), {
    total: 3,
    inUse: 1,
    notSet: 1,
    unknown: 1,
  });
});

Deno.test("toCsv - emits a header and one row per declaration", () => {
  const lines = toCsv(buildRows(INVENTORY, VERDICTS)).trimEnd().split("\n");
  assertEquals(lines.length, 4);
  assert(lines[0].startsWith("slice,owner_file,owner_interface,key,status"));
  assert(lines[1].includes("populationSize"));
});

Deno.test("toCsv - quotes fields containing commas and quotes", () => {
  const csv = toCsv([{
    slice: "nested",
    ownerFile: "a.ts",
    owner: "A",
    key: "k",
    status: "IN USE",
    setBy: ["x", "y"],
    verdictCandidate: 'KEEP, "really"',
    detail: "one,two",
  }]);
  assert(csv.includes('"KEEP, ""really"""'), "quotes must be doubled");
  assert(csv.includes('"one,two"'), "commas must be quoted");
});

Deno.test("toMarkdown - renders a summary and a table row per declaration", () => {
  const md = toMarkdown(buildRows(INVENTORY, VERDICTS), "Baseline");
  assert(md.startsWith("## Baseline"));
  assert(md.includes("`IN USE`: **1**"));
  assert(md.includes("`UNKNOWN`: **1**"));
  assert(md.includes("| `populationSize` |"));
  assert(md.includes("| `archiveLimit` |"));
});

Deno.test("toMarkdown - escapes pipes so the table cannot break", () => {
  const md = toMarkdown([{
    slice: "nested",
    ownerFile: "a.ts",
    owner: "A",
    key: "k",
    status: "IN USE",
    setBy: ["a|b"],
    verdictCandidate: "KEEP",
    detail: "",
  }], "T");
  assert(md.includes("a\\|b"));
});
