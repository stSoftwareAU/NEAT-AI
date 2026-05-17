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
 *     [neat-ai] running version X.Y.Z          (JSR consumers)
 *     [neat-ai] running version X.Y.Z (local)  (local file:// dev/test load)
 *
 * Issue #2720: the previous `FALLBACK_NEAT_AI_VERSION` constant duplicated
 * `deno.json` `version` and required a sync test to police drift. Per KISS,
 * the `file://` (local dev/test) load path now reads `deno.json` once at
 * module load and treats it as the single source of truth. JSR consumers
 * still derive the version from `import.meta.url` — no file I/O.
 *
 * ## Convention
 *
 * Any entry point that constructs a Creature (or otherwise boots the
 * library) calls {@link logNeatAiVersionOnce}. The `Creature` constructor
 * does this automatically — sub-workers that build creatures get the log
 * for free. The function is idempotent (a module-level flag), so the line
 * fires at most once per worker process even across many constructions.
 */

import { getLogger } from "@utils/Logger.ts";

/**
 * Source of the resolved version string. `"jsr"` means the version was
 * parsed from `import.meta.url`; `"local"` means it was read from
 * `deno.json` (i.e. the module was loaded over a `file://` URL during
 * development or tests).
 */
type VersionSource = "jsr" | "local";

interface VersionInfo {
  readonly version: string;
  readonly source: VersionSource;
}

/**
 * Reads `deno.json` (relative to this module) and returns its `version`.
 * Only invoked on the local `file://` load path — JSR consumers never
 * reach this code path.
 */
function readLocalVersionFromDenoJson(): string {
  // src/utils/Version.ts → ../../deno.json
  const denoJsonUrl = new URL("../../deno.json", import.meta.url);
  const parsed = JSON.parse(Deno.readTextFileSync(denoJsonUrl));
  if (typeof parsed.version !== "string") {
    throw new Error(
      "deno.json must define a string `version` for the local load path",
    );
  }
  return parsed.version;
}

function resolveVersionInfo(): VersionInfo {
  const match = import.meta.url.match(
    /@stsoftware\/neat-ai\/(\d+\.\d+\.\d+)/,
  );
  if (match) return { version: match[1], source: "jsr" };
  return { version: readLocalVersionFromDenoJson(), source: "local" };
}

// Module-level read: happens at most once per worker process and only on
// the local load path. JSR consumers skip the file I/O entirely.
const VERSION_INFO: VersionInfo = resolveVersionInfo();

/**
 * Returns the running `@stsoftware/neat-ai` version.
 *
 * Derived from `import.meta.url` when this module is loaded from JSR
 * (the URL embeds the version), or from `deno.json` `version` when loaded
 * locally over `file://`. The result is cached at module load.
 */
export function getNeatAiVersion(): string {
  return VERSION_INFO.version;
}

let versionLogged = false;

/**
 * Emits a single `[neat-ai] running version X.Y.Z` line per worker process.
 * Local file:// loads append a ` (local)` suffix so a dev/test log line
 * cannot be confused with a published JSR build.
 *
 * Idempotent: subsequent calls are no-ops. The first call (typically from
 * the `Creature` constructor) triggers the log via the configured
 * NEAT-AI {@link Logger} at `info` severity.
 *
 * @returns the version that was logged (or would have been logged on the
 *          first call), so callers can also surface it elsewhere if needed.
 */
export function logNeatAiVersionOnce(): string {
  if (versionLogged) return VERSION_INFO.version;
  versionLogged = true;
  const suffix = VERSION_INFO.source === "local" ? " (local)" : "";
  getLogger().info(
    `[neat-ai] running version ${VERSION_INFO.version}${suffix}`,
  );
  return VERSION_INFO.version;
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
