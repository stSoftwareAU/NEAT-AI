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
   * Issue #3928: whether the probed binary advertises `--race-stdio`, the
   * stdio surface over the scorer's early-exit hook (NEAT-AI-scorer#308).
   * A binary without it can only full-score, so a run that asked for racing is
   * warned and scored normally rather than silently believing it raced.
   */
  racingSupported: boolean;
  /**
   * Issue #3870: memoised answer to "can this binary batch `forwardOnly=false`
   * creatures in directory mode?" (NEAT-AI-scorer#579). Resolved lazily by
   * `RecurrentDirectoryProbe.ts` — it costs a subprocess, so it is only paid
   * when a population actually holds a recurrent creature. The promise itself
   * is cached so concurrent callers share one probe.
   */
  recurrentDirectory?: Promise<boolean>;
}

async function defaultRunner(
  command: string,
  args: string[],
  options: {
    env?: Record<string, string>;
    timeoutMs: number;
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
  const cmd = new Deno.Command(command, cmdOptions);

  const output = options.timeoutMs > 0
    ? await Promise.race([
      cmd.output(),
      new Promise<never>((_, reject) => {
        setTimeout(
          () => reject(new Error("rust scorer timeout")),
          options.timeoutMs,
        );
      }),
    ])
    : await cmd.output();

  return {
    success: output.success,
    code: output.code,
    stdout: new TextDecoder().decode(output.stdout),
    stderr: new TextDecoder().decode(output.stderr),
  };
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
  let racingSupported = false;
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
    // Issue #3928: same detection shape as `--cost` — the racing surface is a
    // capability of the installed binary, not of the configuration.
    racingSupported = /(^|\s|,)--race-stdio\b/.test(helpText);
  } catch {
    available = false;
  }

  return {
    available,
    binaryPath: config.binaryPath,
    warned: false,
    costSupported,
    racingSupported,
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
