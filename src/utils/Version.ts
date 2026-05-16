/**
 * NEAT-AI runtime version visibility.
 *
 * Issue #2682: GRQ workers running a stale `@stsoftware/neat-ai` pin caused
 * a topology-hash trap storm (the position-blind topology-hash collision fix
 * from PR #2678 landed only in `5.0.14`+). Without a startup log, the only
 * way to discover the running version was to read it out of a captured
 * stack trace. Every NEAT-AI worker now emits a single line at startup so
 * the running version is always visible:
 *
 *     [neat-ai] running version X.Y.Z
 *
 * ## Convention
 *
 * Any entry point that constructs a Creature (or otherwise boots the
 * library) calls {@link logNeatAiVersionOnce}. The `Creature` constructor
 * does this automatically — sub-workers that build creatures get the log
 * for free. The function is idempotent (a module-level flag), so the line
 * fires at most once per worker process even across many constructions.
 *
 * ## Version derivation
 *
 * The version comes from {@link import.meta.url}: when this module is
 * loaded from JSR the URL embeds the version (e.g.
 * `https://jsr.io/@stsoftware/neat-ai/5.0.14/src/utils/Version.ts`). For
 * local `file://` loads during development the {@link FALLBACK_NEAT_AI_VERSION}
 * constant is used. No runtime file I/O.
 *
 * The fallback constant is kept in sync with `deno.json`'s `version` by the
 * test in `test/creature/VersionStartupLog.ts` — a mismatch fails the
 * quality gate.
 */

import { getLogger } from "@utils/Logger.ts";

/**
 * Fallback version string used when `import.meta.url` is not a JSR URL
 * (e.g. local `file://` loads during development and tests).
 *
 * Must equal `deno.json` `version`. The version-sync test enforces this.
 */
export const FALLBACK_NEAT_AI_VERSION = "5.0.18";

/**
 * Returns the running `@stsoftware/neat-ai` version.
 *
 * Derived from `import.meta.url` when this module is loaded from JSR
 * (the URL embeds the version), or {@link FALLBACK_NEAT_AI_VERSION}
 * otherwise. No filesystem I/O is performed.
 */
export function getNeatAiVersion(): string {
  const url = import.meta.url;
  const match = url.match(/@stsoftware\/neat-ai\/(\d+\.\d+\.\d+)/);
  return match ? match[1] : FALLBACK_NEAT_AI_VERSION;
}

let versionLogged = false;

/**
 * Emits a single `[neat-ai] running version X.Y.Z` line per worker process.
 *
 * Idempotent: subsequent calls are no-ops. The first call (typically from
 * the `Creature` constructor) triggers the log via the configured
 * NEAT-AI {@link Logger} at `info` severity.
 *
 * @returns the version that was logged (or would have been logged on the
 *          first call), so callers can also surface it elsewhere if needed.
 */
export function logNeatAiVersionOnce(): string {
  const version = getNeatAiVersion();
  if (versionLogged) return version;
  versionLogged = true;
  getLogger().info(`[neat-ai] running version ${version}`);
  return version;
}

/**
 * Test-only hook: clears the once-per-process flag so a test can re-exercise
 * the idempotent behaviour. Not part of the public runtime API.
 *
 * @internal
 */
export function resetNeatAiVersionLogForTest(): void {
  versionLogged = false;
}
