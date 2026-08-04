/**
 * Discovery analysis memory budget → `memory.maxAnalysisMemoryMb` wiring
 * (Issue #3565).
 *
 * ## Why this exists
 *
 * `memory.maxAnalysisMemoryMb` (#3432) is the only in-flight brake on
 * `analyze_parallel` growing the resident set until the host OOMs: the FFI call
 * is blocking, so no JS timer or heap sample runs while Rust allocates. Its
 * default is `0` ("send no budget"), and the production runner never set it —
 * so Discovery analysis ran with no Rust-side allocator budget at all.
 *
 * The runner already computes the right number, so this module mirrors the
 * {@link ./DiscoveryWorkerEnvelope.ts} precedent: the external runner exports
 * the budget as {@link ANALYSIS_MEMORY_BUDGET_ENV} and `createNeatConfig`
 * seeds `memory.maxAnalysisMemoryMb` from it **automatically** — no per-caller
 * opt-in. An explicitly supplied option always wins, and with the variable
 * unset behaviour is unchanged (the budget stays off).
 *
 * @module
 */

import type { EnvReader } from "@workers/WorkerHeapBudget.ts";
import { getLogger, type Logger } from "@utils/Logger.ts";

export type { EnvReader };

/**
 * Environment variable the external Discovery runner sets to the analysis-phase
 * memory budget (MB) handed to Rust on every `analyze_parallel` call.
 */
export const ANALYSIS_MEMORY_BUDGET_ENV = "DISCOVERY_ANALYSIS_MEMORY_BUDGET_MB";

/**
 * Resolve the analysis memory budget (MB) exported by the Discovery runner.
 *
 * Returns `undefined` when the variable is unset or empty — every non-Discovery
 * caller — so the option keeps its `0` default and no budget is sent. A value
 * that is present but not a positive integer is **ignored loudly**: it warns and
 * falls back to the default rather than crashing startup or silently applying a
 * nonsensical budget. Reading is wrapped in `try/catch` so a missing
 * `--allow-env` permission is treated as unconfigured.
 *
 * @param env - Environment reader (defaults to `Deno.env`).
 * @param logger - Logger for the invalid-value warning (defaults to the global).
 */
export function resolveAnalysisMemoryBudgetEnvMb(
  env: EnvReader = Deno.env,
  logger: Logger = getLogger(),
): number | undefined {
  let raw: string | undefined;
  try {
    raw = env.get(ANALYSIS_MEMORY_BUDGET_ENV) ?? undefined;
  } catch {
    // No --allow-env (or reader threw): treat as unconfigured.
    return undefined;
  }
  if (raw === undefined) return undefined;
  const trimmed = raw.trim();
  if (trimmed === "") return undefined;

  const budget = Number(trimmed);
  if (!Number.isSafeInteger(budget) || budget <= 0) {
    logger.warn(
      `[NEAT-AI] Ignoring ${ANALYSIS_MEMORY_BUDGET_ENV}="${raw}": ` +
        `expected a positive integer of megabytes — no analysis memory ` +
        `budget will be sent to Discovery.`,
    );
    return undefined;
  }
  return budget;
}

/**
 * Merge the runner-exported budget under any explicit `memory` overrides.
 *
 * The explicit option always wins — including an explicit `0`, which is a
 * deliberate "send no budget". Returns the user overrides unchanged when no
 * budget is exported, so the parser's static defaults apply.
 *
 * @param userOverrides - Raw `memory` overrides from user options.
 * @param envBudgetMb - Runner-exported budget, or `undefined` when unset.
 */
export function mergeAnalysisMemoryBudgetDefault(
  userOverrides: Record<string, unknown> | undefined,
  envBudgetMb: number | undefined,
): Record<string, unknown> | undefined {
  if (envBudgetMb === undefined) return userOverrides;
  if (userOverrides?.maxAnalysisMemoryMb !== undefined) return userOverrides;
  return { maxAnalysisMemoryMb: envBudgetMb, ...userOverrides };
}
