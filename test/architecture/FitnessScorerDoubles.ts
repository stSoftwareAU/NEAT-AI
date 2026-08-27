/**
 * Stand-ins for the two `rust_scorer` generations the batch path must serve
 * (Issue #3870).
 *
 * Both doubles answer the *same* questions the real binary does — `--help`,
 * then `(creatures_dir, data_dir)` — and decide from the creature files they
 * are handed, exactly as the binary does. Neither knows anything about the
 * capability probe, so a test written against them stays honest if the probe's
 * shape changes:
 *
 * - {@link legacyScorer} — pre-NEAT-AI-scorer#579. Refuses any directory
 *   containing a `forwardOnly=false` creature (exit 1, no JSON), which is what
 *   makes the probe answer "unsupported" and the partition stay in place.
 * - {@link modernScorer} — post-#579. Scores every creature it is given,
 *   recurrent or not.
 */
import type { CommandRunner } from "../../src/score/RustScorerBridgeInternal.ts";

/** Verbatim shape of the pre-#579 refusal, including the exit code. */
const REFUSAL = (path: string) =>
  `Error: Creature '${path}' has forwardOnly=false; multi-creature directory ` +
  `mode requires forwardOnly=true for every creature`;

/** One directory-mode invocation, as the double saw it. */
export interface DirectoryCall {
  /** Filename stems in the creatures directory, sorted. */
  stems: string[];
  /** Subset of {@link stems} whose creature declared `forwardOnly: false`. */
  recurrentStems: string[];
  /** Whether the call was refused. */
  refused: boolean;
}

/** Call log shared by both doubles. */
export interface ScorerDoubleLog {
  helpCalls: number;
  directoryCalls: DirectoryCall[];
  /**
   * Directory calls that carried at least one recurrent creature — a pre-#579
   * binary refuses exactly these.
   */
  recurrentCalls(): DirectoryCall[];
}

function newLog(): ScorerDoubleLog {
  const log: ScorerDoubleLog = {
    helpCalls: 0,
    directoryCalls: [],
    recurrentCalls: () =>
      log.directoryCalls.filter((call) => call.recurrentStems.length > 0),
  };
  return log;
}

async function readCreatures(
  dir: string,
): Promise<{ stems: string[]; recurrentStems: string[]; firstPath: string }> {
  const stems: string[] = [];
  const recurrentStems: string[] = [];
  let firstPath = "";
  for await (const entry of Deno.readDir(dir)) {
    if (!entry.isFile || !entry.name.endsWith(".json")) continue;
    const stem = entry.name.replace(/\.json$/, "");
    const path = `${dir}/${entry.name}`;
    stems.push(stem);
    const creature = JSON.parse(await Deno.readTextFile(path));
    if (creature.forwardOnly !== true) {
      recurrentStems.push(stem);
      if (!firstPath) firstPath = path;
    }
  }
  stems.sort();
  recurrentStems.sort();
  return { stems, recurrentStems, firstPath };
}

function payloadFor(stems: string[], error: number): string {
  const payload: Record<string, unknown> = {};
  for (const stem of stems) {
    payload[stem] = { score: 0.5, error, recordCount: 4 };
  }
  return JSON.stringify(payload);
}

/**
 * A `rust_scorer` from before NEAT-AI-scorer#579: directory mode refuses at
 * load time as soon as one creature is recurrent.
 *
 * @param error - the `error` value returned for every scored creature.
 */
export function legacyScorer(
  error = 0.25,
): { runner: CommandRunner; log: ScorerDoubleLog } {
  const log = newLog();
  const runner: CommandRunner = async (_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      log.helpCalls++;
      return {
        success: true,
        code: 0,
        stdout: "usage --cost <NAME>",
        stderr: "",
      };
    }
    const dir = args[args.length - 2];
    const { stems, recurrentStems, firstPath } = await readCreatures(dir);
    const refused = recurrentStems.length > 0;
    log.directoryCalls.push({ stems, recurrentStems, refused });
    if (refused) {
      return {
        success: false,
        code: 1,
        stdout: "",
        stderr: REFUSAL(firstPath),
      };
    }
    return {
      success: true,
      code: 0,
      stdout: payloadFor(stems, error),
      stderr: "",
    };
  };
  return { runner, log };
}

/**
 * A `rust_scorer` with NEAT-AI-scorer#579: every creature in the directory is
 * scored under its own `forwardOnly` flag.
 *
 * @param error - the `error` value returned for every scored creature.
 */
export function modernScorer(
  error = 0.25,
): { runner: CommandRunner; log: ScorerDoubleLog } {
  const log = newLog();
  const runner: CommandRunner = async (_command, args) => {
    if (args.length === 1 && args[0] === "--help") {
      log.helpCalls++;
      return {
        success: true,
        code: 0,
        stdout: "usage --cost <NAME>",
        stderr: "",
      };
    }
    const dir = args[args.length - 2];
    const { stems, recurrentStems } = await readCreatures(dir);
    log.directoryCalls.push({ stems, recurrentStems, refused: false });
    return {
      success: true,
      code: 0,
      stdout: payloadFor(stems, error),
      stderr: "",
    };
  };
  return { runner, log };
}
