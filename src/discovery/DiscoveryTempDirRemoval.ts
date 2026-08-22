/**
 * Verified removal of a discovery temporary directory.
 *
 * GRQ #4241: `DiscoverStructureBase.cleanUp()` used to swallow a failed
 * `Deno.remove(tempDir, { recursive: true })` into a single warn line, so the
 * caller went straight on to log `Discovery <id> cleanup complete.` A run that
 * left its whole temp directory behind therefore read as a clean cleanup, and
 * the directories accumulated under `.discovery/` until the host ran out of
 * disk. The observed failure was `Directory not empty (os error 66)` — a
 * writer still creating files while the recursive walk ran.
 *
 * This module removes the directory, **positively confirms** it is gone, and
 * throws an error naming the leftover entries when it is not. Nothing here
 * reports success unless the directory has actually disappeared.
 */

/** Default number of removal attempts before giving up. */
const DEFAULT_ATTEMPTS = 3;

/** Default pause between removal attempts, in milliseconds. */
const DEFAULT_RETRY_DELAY_MS = 50;

/** Maximum number of leftover entries named in a failure message. */
const DEFAULT_LEFTOVER_LIMIT = 20;

/** Options for {@link removeDiscoveryTempDir}. */
export interface RemoveDiscoveryTempDirOptions {
  /**
   * Number of removal attempts. A concurrent writer racing the recursive walk
   * yields `ENOTEMPTY`, which normally clears on a retry. Defaults to 3;
   * values below 1 are treated as 1.
   */
  attempts?: number;
  /** Milliseconds to wait between attempts. Defaults to 50. */
  retryDelayMs?: number;
  /**
   * Removal implementation. Defaults to a recursive `Deno.remove`. Injected by
   * tests to reproduce the concurrent-writer race deterministically.
   */
  remove?: (dir: string) => Promise<void>;
}

/**
 * Lists the entries still present under `dir`, depth-first, as paths relative
 * to `dir`. Used to name the writer that kept the directory alive.
 *
 * @param dir - Directory to enumerate.
 * @param limit - Maximum number of entries returned. Defaults to 20.
 * @returns Relative entry paths; empty when `dir` is absent or unreadable.
 */
export function listDiscoveryLeftovers(
  dir: string,
  limit: number = DEFAULT_LEFTOVER_LIMIT,
): string[] {
  const found: string[] = [];
  if (limit <= 0) return found;
  const pending: string[] = [""];

  while (pending.length > 0 && found.length < limit) {
    const relativeDir = pending.pop() as string;
    const absoluteDir = relativeDir === "" ? dir : `${dir}/${relativeDir}`;
    let entries: Deno.DirEntry[];
    try {
      entries = Array.from(Deno.readDirSync(absoluteDir));
    } catch {
      // Unreadable or removed while walking — nothing more to name here.
      continue;
    }
    for (const entry of entries) {
      const relative = relativeDir === ""
        ? entry.name
        : `${relativeDir}/${entry.name}`;
      found.push(relative);
      if (found.length >= limit) break;
      if (entry.isDirectory) pending.push(relative);
    }
  }

  return found;
}

/** Resolves after `ms` milliseconds. */
function delay(ms: number): Promise<void> {
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Reports whether `dir` still exists. A stat error other than `NotFound`
 * cannot confirm removal, so the path is reported as still present — absence
 * of a failure is not success.
 */
function stillExists(dir: string): boolean {
  try {
    Deno.lstatSync(dir);
    return true;
  } catch (error) {
    return !(error instanceof Deno.errors.NotFound);
  }
}

/** Formats the leftover entry list for the failure message. */
function describeLeftovers(dir: string, limit: number): string {
  const leftovers = listDiscoveryLeftovers(dir, limit + 1);
  if (leftovers.length === 0) return "no readable entries";
  const shown = leftovers.slice(0, limit);
  const suffix = leftovers.length > limit ? ", …" : "";
  return `${shown.join(", ")}${suffix}`;
}

/**
 * Removes a discovery temporary directory and confirms it is gone.
 *
 * Retries a failed removal a bounded number of times — the production failure
 * is a race with a writer still creating files — and throws an error naming
 * the directory, the leftover entries, and the underlying error when the
 * directory survives every attempt.
 *
 * @param dir - The discovery temp directory to remove.
 * @param options - Attempt count, retry delay, and removal injection seam.
 * @throws Error when `dir` still exists after the final attempt.
 */
export async function removeDiscoveryTempDir(
  dir: string,
  options: RemoveDiscoveryTempDirOptions = {},
): Promise<void> {
  const attempts = Math.max(
    1,
    Math.floor(options.attempts ?? DEFAULT_ATTEMPTS),
  );
  const retryDelayMs = Math.max(
    0,
    options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
  );
  const remove = options.remove ??
    ((path: string) => Deno.remove(path, { recursive: true }));

  let lastError: unknown;
  for (let attempt = 1; attempt <= attempts; attempt++) {
    try {
      // Retries are sequential by design — the next attempt only makes sense
      // once the previous one has failed and the racing writer has settled.
      // deno-lint-ignore no-await-in-loop
      await remove(dir);
      lastError = undefined;
    } catch (error) {
      if (error instanceof Deno.errors.NotFound) {
        // Already gone — another cleanup won the race.
        return;
      }
      lastError = error;
    }

    if (!stillExists(dir)) return;

    // deno-lint-ignore no-await-in-loop
    if (attempt < attempts) await delay(retryDelayMs);
  }

  const reason = lastError === undefined
    ? "the removal reported success but the directory is still present"
    : `last error: ${lastError}`;
  throw new Error(
    `Discovery temp dir cleanup failed: '${dir}' still exists after ${attempts} attempt(s) — ` +
      `leftover entries: ${
        describeLeftovers(dir, DEFAULT_LEFTOVER_LIMIT)
      } (${reason})`,
  );
}
