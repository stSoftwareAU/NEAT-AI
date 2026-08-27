/**
 * Internal helpers shared between the per-creature and batch rust scorer
 * bridges (Issue #2422).
 *
 * This module owns the pieces that must be singletons for both call paths:
 *
 * - The injected command runner (tests swap this for a fake via
 *   `__setRustScorerRunnerForTests` on `RustScorerBridge.ts`).
 * - The probe cache — both bridges must share a single probe so the
 *   `rust_scorer --help` check is only paid once per config.
 * - Child-env construction so batch and single modes agree on how to merge
 *   caller-supplied overrides with the parent environment.
 *
 * @module RustScorerBridgeInternal
 */

import type { RequiredRustScorerConfig } from "@config/RustScorerConfig.ts";

/** Signature of a subprocess runner used by the rust scorer bridges. */
export type CommandRunner = (
  command: string,
  args: string[],
  options: {
    env?: Record<string, string>;
    timeoutMs: number;
    /**
     * GRQ #4418: the run's hard-deadline abort. When it fires the child is
     * killed and the call fails loud — a scorer whose pipes never close must
     * not outlive the unit that spawned it.
     */
    signal?: AbortSignal;
  },
) => Promise<{
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
}>;

/** Shape of a probe result cached per configuration. */
export interface RustScorerProbeState {
  available: boolean;
  binaryPath: string;
  warned: boolean;
  /**
   * Issue #2745: Whether the probed `rust_scorer` binary advertises the
   * `--cost <NAME>` flag in its `--help` output. Older binaries that
   * silently compute MSE only set this to `false`; the bridge then falls
   * back to WASM scoring whenever a non-MSE cost is configured rather than
   * silently disagreeing with the TS layer.
   */
  costSupported: boolean;
  /**
   * Issue #3870: memoised answer to "can this binary batch `forwardOnly=false`
   * creatures in directory mode?" (NEAT-AI-scorer#579). Resolved lazily by
   * `RecurrentDirectoryProbe.ts` — it costs a subprocess, so it is only paid
   * when a population actually holds a recurrent creature. The promise itself
   * is cached so concurrent callers share one probe.
   */
  recurrentDirectory?: Promise<boolean>;
}

/**
 * GRQ #4418: how long the killed child's pipes get to close before the read is
 * abandoned. A scorer that spawned a grandchild holding stdout keeps
 * `child.output()` pending even after the process itself is dead — the GRQ-26
 * wedge, where the batch error only surfaced as the wall-clock cap unwound the
 * process 2h 42m later. Waiting forever on the drain would reinstate exactly
 * that hang.
 */
const KILL_DRAIN_MS = 2_000;

async function defaultRunner(
  command: string,
  args: string[],
  options: {
    env?: Record<string, string>;
    timeoutMs: number;
    signal?: AbortSignal;
  },
): Promise<{
  success: boolean;
  code: number;
  stdout: string;
  stderr: string;
}> {
  const cmdOptions: Deno.CommandOptions = options.env !== undefined
    ? { args, env: options.env, stdout: "piped", stderr: "piped" }
    : { args, stdout: "piped", stderr: "piped" };
  const child = new Deno.Command(command, cmdOptions).spawn();
  const outputPromise = child.output();
  // The read is abandoned when a killed child's pipes stay open; claim it so a
  // late failure cannot surface as an unhandled rejection.
  outputPromise.catch(() => {});

  let killedBecause: string | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let drainTimer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;

  let abandonDrain!: () => void;
  const drained = new Promise<undefined>((resolve) => {
    abandonDrain = () => resolve(undefined);
  });

  const kill = (because: string) => {
    if (killedBecause !== undefined) return;
    killedBecause = because;
    try {
      child.kill("SIGKILL");
    } catch {
      // Already exited — the failure is reported from `killedBecause` anyway.
    }
    drainTimer = setTimeout(abandonDrain, KILL_DRAIN_MS);
  };

  if (options.timeoutMs > 0) {
    timer = setTimeout(() => kill("timeout"), options.timeoutMs);
  }
  if (options.signal) {
    if (options.signal.aborted) {
      kill("aborted");
    } else {
      onAbort = () => kill("aborted");
      options.signal.addEventListener("abort", onAbort, { once: true });
    }
  }

  try {
    const output = await Promise.race([outputPromise, drained]);

    if (output === undefined) {
      throw new Error(
        `rust scorer ${killedBecause}; the child was killed but its pipes did ` +
          `not close within ${KILL_DRAIN_MS}ms — abandoning the read`,
      );
    }
    if (killedBecause !== undefined) {
      throw new Error(
        `rust scorer ${killedBecause} (killed, exit ${output.code})`,
      );
    }

    return {
      success: output.success,
      code: output.code,
      stdout: new TextDecoder().decode(output.stdout),
      stderr: new TextDecoder().decode(output.stderr),
    };
  } finally {
    if (timer !== undefined) clearTimeout(timer);
    if (drainTimer !== undefined) clearTimeout(drainTimer);
    if (onAbort && options.signal) {
      options.signal.removeEventListener("abort", onAbort);
    }
  }
}

let runCommand: CommandRunner = defaultRunner;

/**
 * Cached per configuration. The **promise** is cached rather than the resolved
 * state so concurrent first callers share one `--help` spawn and — more
 * importantly since Issue #3870 — one state object, which is where the
 * recurrent-capability answer is memoised.
 */
const probeCache = new Map<string, Promise<RustScorerProbeState>>();

/**
 * Build the env argument for a child process call.
 *
 * Returns `undefined` when no overrides are configured so the child inherits
 * the parent environment verbatim (avoids the `env: {}` foot-gun where the
 * child gets an empty environment). When overrides exist, merges them over
 * the parent env snapshot.
 */
export function buildChildEnv(
  overrides: Record<string, string>,
): Record<string, string> | undefined {
  const keys = Object.keys(overrides);
  if (keys.length === 0) return undefined;
  let parent: Record<string, string> = {};
  try {
    parent = Deno.env.toObject();
  } catch {
    // Fall through with an empty parent snapshot; overrides still applied.
  }
  return { ...parent, ...overrides };
}

function makeProbeKey(config: RequiredRustScorerConfig): string {
  const envKeys = Object.keys(config.env).sort();
  const envPairs = envKeys.map((k) => `${k}=${config.env[k]}`);
  return `${config.binaryPath}|${config.timeoutMs}|${envPairs.join(",")}`;
}

/**
 * Resolve the probe state for a given scorer configuration. Cached so the
 * probe call is only paid once per config across both per-creature and batch
 * scoring paths.
 */
export function resolveProbeState(
  config: RequiredRustScorerConfig,
): Promise<RustScorerProbeState> {
  const key = makeProbeKey(config);
  const cached = probeCache.get(key);
  if (cached) return cached;
  const pending = runProbe(config);
  probeCache.set(key, pending);
  return pending;
}

async function runProbe(
  config: RequiredRustScorerConfig,
): Promise<RustScorerProbeState> {
  let available = false;
  let costSupported = false;
  try {
    const probe = await runCommand(config.binaryPath, ["--help"], {
      env: buildChildEnv(config.env),
      timeoutMs: config.timeoutMs,
    });
    available = probe.success || probe.code === 0 || probe.code === 1;
    // Issue #2745: Detect whether the binary advertises `--cost`. We look
    // in both stdout and stderr because clap-style help may write to either
    // depending on whether `--help` exits 0 or 2.
    const helpText = `${probe.stdout ?? ""}\n${probe.stderr ?? ""}`;
    costSupported = /(^|\s|,)--cost\b/.test(helpText);
  } catch {
    available = false;
  }

  return {
    available,
    binaryPath: config.binaryPath,
    warned: false,
    costSupported,
  };
}

/** Access the current runner for both bridges. */
export function __getBatchRunner(): CommandRunner {
  return runCommand;
}

/** Replace the runner (test hook shared with `RustScorerBridge.ts`). */
export function __setRunnerInternal(runner: CommandRunner): void {
  runCommand = runner;
}

/** Reset internal state (test hook shared with `RustScorerBridge.ts`). */
export function __resetInternal(): void {
  probeCache.clear();
  runCommand = defaultRunner;
}
