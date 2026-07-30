/**
 * Verdict resolution for the #3505 option-removal audit (Issue #3518).
 *
 * Combines probe results into a per-key verdict. The script decides `IN USE`
 * vs `not set` only — the `QUALIFIES` vs `KEEP (load-bearing default)` call
 * needs a human reading the default's code path.
 */

import type {
  ConsumerRepo,
  KeyProbe,
  ProbeResult,
  Resolution,
} from "./optionUsageProbes.ts";

/** Verdict for one key against one consumer, or for the key overall. */
export type UsageStatus = "IN USE" | "not set" | "UNKNOWN";

/** How one consumer answered for one key. */
export interface ConsumerVerdict {
  repo: string;
  status: UsageStatus;
  /** `probe:path` strings for the matches found. */
  evidence: string[];
  /** `probe: note` strings for probes that could not resolve. */
  notes: string[];
}

/** The audited outcome for one key. */
export interface KeyVerdict {
  key: string;
  status: UsageStatus;
  /** Consumers that mention the key. */
  setBy: string[];
  consumers: ConsumerVerdict[];
}

/**
 * Fold every probe's answer for one consumer into a single status.
 *
 * A hit from any probe wins. Otherwise at least one probe must have genuinely
 * searched (`miss`); if none did, the consumer is `UNKNOWN`. An unresolved
 * probe is never treated as "not set".
 */
export function resolveConsumer(
  repo: string,
  results: { probe: string; result: ProbeResult }[],
): ConsumerVerdict {
  const evidence: string[] = [];
  const notes: string[] = [];
  let seen: Resolution | null = null;

  for (const { probe, result } of results) {
    if (result.note) notes.push(`${probe}: ${result.note}`);
    if (result.resolution === "hit") {
      seen = "hit";
      for (const path of result.paths) evidence.push(`${probe}:${path}`);
    } else if (result.resolution === "miss" && seen !== "hit") {
      seen = "miss";
    }
  }

  if (seen === "hit") return { repo, status: "IN USE", evidence, notes };
  if (seen === "miss") return { repo, status: "not set", evidence, notes };
  return {
    repo,
    status: "UNKNOWN",
    evidence,
    notes: notes.length > 0 ? notes : ["no probe resolved"],
  };
}

/**
 * Fold per-consumer verdicts into the key verdict. Any `UNKNOWN` consumer
 * makes the whole key `UNKNOWN` — a partial sweep must never read as a clean
 * "not set".
 */
export function verdictForKey(
  key: string,
  consumers: ConsumerVerdict[],
): KeyVerdict {
  if (consumers.length === 0) {
    return {
      key,
      status: "UNKNOWN",
      setBy: [],
      consumers: [{
        repo: "(none)",
        status: "UNKNOWN",
        evidence: [],
        notes: ["no consumers configured"],
      }],
    };
  }
  const setBy = consumers.filter((c) => c.status === "IN USE").map((c) =>
    c.repo
  );
  const status: UsageStatus = consumers.some((c) => c.status === "UNKNOWN")
    ? "UNKNOWN"
    : setBy.length > 0
    ? "IN USE"
    : "not set";
  return { key, status, setBy, consumers };
}

/** Disk-backed memo of probe results, so a re-run costs no search quota. */
export class ProbeCache {
  private entries = new Map<string, ProbeResult>();
  private dirty = false;

  constructor(private readonly path?: string) {}

  static cacheKey(probe: string, repo: string, key: string): string {
    return `${probe}|${repo}|${key}`;
  }

  async load(): Promise<void> {
    if (!this.path) return;
    try {
      const raw = await Deno.readTextFile(this.path);
      const parsed = JSON.parse(raw) as Record<string, ProbeResult>;
      this.entries = new Map(Object.entries(parsed));
    } catch (error) {
      // A missing cache is normal on a first run. Anything else is corruption
      // and must be loud rather than silently starting from empty.
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }

  get(probe: string, repo: string, key: string): ProbeResult | undefined {
    return this.entries.get(ProbeCache.cacheKey(probe, repo, key));
  }

  set(probe: string, repo: string, key: string, result: ProbeResult): void {
    // Never cache a failure: a rate-limited probe must be retried next run.
    if (result.resolution === "unresolved") return;
    this.entries.set(ProbeCache.cacheKey(probe, repo, key), result);
    this.dirty = true;
  }

  get size(): number {
    return this.entries.size;
  }

  async save(): Promise<void> {
    if (!this.path || !this.dirty) return;
    const asObject = Object.fromEntries([...this.entries].sort());
    await Deno.writeTextFile(
      this.path,
      `${JSON.stringify(asObject, null, 2)}\n`,
    );
    this.dirty = false;
  }
}

/** The two keys that prove the search plumbing still works. */
export interface ControlSpec {
  /** Key known to be set by every listed consumer. */
  positiveKey: string;
  /** Key known to be absent from every listed consumer. */
  negativeKey: string;
  /** Repositories both controls are asserted against. */
  repos: string[];
}

/** A control that did not behave as expected. */
export interface ControlFailure {
  control: "positive" | "negative";
  key: string;
  reason: string;
}

/**
 * Check the built-in controls before the main sweep.
 *
 * The positive control catches the `--owner` saturation trap, a stale cache, or
 * a consumer the code-search index skipped — any of which would flip a
 * load-bearing option to "not set". The negative control catches the opposite
 * failure, a probe that matches everything.
 */
export function evaluateControls(
  verdicts: KeyVerdict[],
  spec: ControlSpec,
): ControlFailure[] {
  const failures: ControlFailure[] = [];
  const byKey = new Map(verdicts.map((v) => [v.key, v]));

  const positive = byKey.get(spec.positiveKey);
  if (!positive) {
    failures.push({
      control: "positive",
      key: spec.positiveKey,
      reason: "control was not scanned",
    });
  } else {
    for (const repo of spec.repos) {
      const consumer = positive.consumers.find((c) => c.repo === repo);
      if (consumer?.status !== "IN USE") {
        failures.push({
          control: "positive",
          key: spec.positiveKey,
          reason: `expected IN USE in ${repo}, got ${
            consumer?.status ?? "no result"
          }`,
        });
      }
    }
  }

  const negative = byKey.get(spec.negativeKey);
  if (!negative) {
    failures.push({
      control: "negative",
      key: spec.negativeKey,
      reason: "control was not scanned",
    });
  } else {
    for (const repo of spec.repos) {
      const consumer = negative.consumers.find((c) => c.repo === repo);
      if (consumer?.status !== "not set") {
        failures.push({
          control: "negative",
          key: spec.negativeKey,
          reason: `expected not set in ${repo}, got ${
            consumer?.status ?? "no result"
          }`,
        });
      }
    }
  }

  return failures;
}

/** Wiring for {@link scanKeys}. */
export interface ScanOptions {
  /** Fast, complete probe over local clones. Runs first. */
  localProbe: KeyProbe;
  /** Rate-limited GitHub code search. Runs only where local did not hit. */
  searchProbe?: KeyProbe;
  cache?: ProbeCache;
  /** Called after each key, for progress output on a long run. */
  onProgress?: (done: number, total: number, verdict: KeyVerdict) => void;
}

async function runProbe(
  probe: KeyProbe,
  key: string,
  consumer: ConsumerRepo,
  cache?: ProbeCache,
): Promise<ProbeResult> {
  const cached = cache?.get(probe.name, consumer.repo, key);
  if (cached) return cached;
  const result = await probe.probe(key, consumer);
  cache?.set(probe.name, consumer.repo, key, result);
  return result;
}

/**
 * Resolve every key against every consumer.
 *
 * The local probe is authoritative when it finds a match. The rate-limited
 * code search is spent only where local found nothing or could not run — the
 * one direction in which a wrong answer produces a false `QUALIFIES` verdict
 * and gets a load-bearing option removed.
 */
export async function scanKeys(
  keys: string[],
  consumers: ConsumerRepo[],
  options: ScanOptions,
): Promise<KeyVerdict[]> {
  const { localProbe, searchProbe, cache, onProgress } = options;
  const verdicts: KeyVerdict[] = [];

  for (const key of keys) {
    const consumerVerdicts: ConsumerVerdict[] = [];
    for (const consumer of consumers) {
      const results: { probe: string; result: ProbeResult }[] = [];
      // Sequential by design: the code-search probe is rate limited, and
      // running it only after a local miss is what keeps the run affordable.
      // deno-lint-ignore no-await-in-loop
      const local = await runProbe(localProbe, key, consumer, cache);
      results.push({ probe: localProbe.name, result: local });
      if (searchProbe && local.resolution !== "hit") {
        // deno-lint-ignore no-await-in-loop
        const searched = await runProbe(searchProbe, key, consumer, cache);
        results.push({ probe: searchProbe.name, result: searched });
      }
      consumerVerdicts.push(resolveConsumer(consumer.repo, results));
    }
    const verdict = verdictForKey(key, consumerVerdicts);
    verdicts.push(verdict);
    onProgress?.(verdicts.length, keys.length, verdict);
  }

  return verdicts;
}
