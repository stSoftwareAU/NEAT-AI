/**
 * Streaming client for the scorer's `--race-stdio` protocol — Issue #3928.
 *
 * The one-shot {@link CommandRunner} used by the other scorer bridges collects
 * stdout after the process exits, which cannot work here: racing is a
 * conversation. The scorer writes one `{"racing":"chunk",…}` line per scored
 * chunk and **blocks** until it reads exactly one verdict line back, so the
 * caller must consume stdout as it arrives and answer inline.
 *
 * Everything the scorer writes that is not a chunk event is the final result
 * JSON, accumulated verbatim and returned as `stdout` so the existing
 * reconciler parses it unchanged.
 *
 * @module RacingScorerSession
 */

import type { PartialScore, RacingVerdict } from "./RacingPolicy.ts";

/** One chunk event published by the scorer. */
export interface RacingChunkEvent {
  readonly racing: "chunk";
  readonly chunk: number;
  readonly partials: PartialScore[];
}

/** Everything needed to run one racing session. */
export interface RacingSessionRequest {
  readonly binaryPath: string;
  readonly args: string[];
  readonly env?: Record<string, string>;
  /** Wall-clock cap for the whole session; `0` disables the cap. */
  readonly timeoutMs: number;
  /** Called for every chunk event; its verdict is written straight back. */
  readonly onChunk: (event: RacingChunkEvent) => RacingVerdict;
}

/** Outcome of a racing session — the same shape the one-shot runner returns. */
export interface RacingSessionResult {
  readonly success: boolean;
  readonly code: number;
  /** Scorer stdout with the chunk-event lines removed. */
  readonly stdout: string;
  readonly stderr: string;
  /** Chunk events observed during the sweep. */
  readonly chunks: number;
}

/** Signature of a racing session runner (swapped for a fake in tests). */
export type RacingSessionRunner = (
  request: RacingSessionRequest,
) => Promise<RacingSessionResult>;

const CHUNK_EVENT_PREFIX = '{"racing"';

/**
 * Parse one scorer stdout line.
 *
 * Returns the chunk event, or `undefined` when the line belongs to the final
 * result JSON. A line that announces itself as a racing event but does not
 * parse is a protocol fault, not result JSON — it throws rather than being
 * folded into the result the reconciler will read.
 */
export function parseRacingLine(line: string): RacingChunkEvent | undefined {
  const trimmed = line.trim();
  if (!trimmed.startsWith(CHUNK_EVENT_PREFIX)) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    throw new Error(
      `Racing scorer emitted an unparseable chunk event: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  const event = parsed as Partial<RacingChunkEvent>;
  if (event.racing !== "chunk" || !Array.isArray(event.partials)) {
    throw new Error(
      `Racing scorer emitted a chunk event of unexpected shape: ${trimmed}`,
    );
  }
  return {
    racing: "chunk",
    chunk: typeof event.chunk === "number" ? event.chunk : 0,
    partials: event.partials as PartialScore[],
  };
}

/** Serialise a verdict as the single line the scorer expects. */
export function encodeVerdict(verdict: RacingVerdict): string {
  return `${JSON.stringify(verdict)}\n`;
}

async function defaultRacingSessionRunner(
  request: RacingSessionRequest,
): Promise<RacingSessionResult> {
  const options: Deno.CommandOptions = {
    args: request.args,
    stdin: "piped",
    stdout: "piped",
    stderr: "piped",
    ...(request.env !== undefined ? { env: request.env } : {}),
  };
  const child = new Deno.Command(request.binaryPath, options).spawn();

  const decoder = new TextDecoder();
  const encoder = new TextEncoder();
  const stdinWriter = child.stdin.getWriter();
  let stdinOpen = true;
  const closeStdin = async () => {
    if (!stdinOpen) return;
    stdinOpen = false;
    try {
      await stdinWriter.close();
    } catch {
      // The scorer may have exited already; its exit code is the real signal.
    }
  };

  // Drain stderr concurrently: a full stderr pipe would block the scorer
  // mid-sweep and deadlock the conversation.
  const stderrPromise = (async () => {
    let text = "";
    for await (const bytes of child.stderr) text += decoder.decode(bytes);
    return text;
  })();

  let stdout = "";
  let chunks = 0;
  let pending = "";
  let failure: Error | undefined;

  const handleLine = async (line: string): Promise<void> => {
    const event = parseRacingLine(line);
    if (event === undefined) {
      stdout += `${line}\n`;
      return;
    }
    chunks++;
    const verdict = request.onChunk(event);
    if (!stdinOpen) return;
    await stdinWriter.write(encoder.encode(encodeVerdict(verdict)));
  };

  const pump = (async () => {
    for await (const bytes of child.stdout) {
      pending += decoder.decode(bytes, { stream: true });
      let newline = pending.indexOf("\n");
      while (newline >= 0) {
        const line = pending.slice(0, newline);
        pending = pending.slice(newline + 1);
        // The protocol is strict lockstep — the scorer is blocked reading our
        // verdict for this chunk, so the next line cannot be handled until
        // this one has been answered. Collecting the promises and awaiting
        // them together would interleave verdicts and desynchronise the
        // conversation.
        // deno-lint-ignore no-await-in-loop
        await handleLine(line);
        newline = pending.indexOf("\n");
      }
    }
    if (pending.trim().length > 0) await handleLine(pending);
    pending = "";
  })().catch((error: unknown) => {
    failure = error instanceof Error ? error : new Error(String(error));
  }).finally(closeStdin);

  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = request.timeoutMs > 0
    ? new Promise<never>((_, reject) => {
      timer = setTimeout(
        () => reject(new Error("rust scorer racing session timeout")),
        request.timeoutMs,
      );
    })
    : undefined;

  try {
    const status = await (timeout
      ? Promise.race([
        (async () => {
          await pump;
          return await child.status;
        })(),
        timeout,
      ])
      : (async () => {
        await pump;
        return await child.status;
      })());
    const stderr = await stderrPromise;
    if (failure) throw failure;
    return {
      success: status.success,
      code: status.code,
      stdout,
      stderr,
      chunks,
    };
  } catch (error) {
    // Never leave the scorer running behind a failed session.
    try {
      child.kill();
    } catch {
      // Already exited.
    }
    await closeStdin();
    throw error;
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

let runner: RacingSessionRunner = defaultRacingSessionRunner;

/** Current racing session runner. */
export function getRacingSessionRunner(): RacingSessionRunner {
  return runner;
}

/** Replace the racing session runner (test seam). */
export function __setRacingSessionRunnerForTests(
  replacement: RacingSessionRunner,
): void {
  runner = replacement;
}

/** Restore the real subprocess racing session runner (test seam). */
export function __resetRacingSessionRunner(): void {
  runner = defaultRacingSessionRunner;
}
