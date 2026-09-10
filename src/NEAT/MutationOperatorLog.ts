/**
 * MutationOperatorLog.ts - One-line rendering of the per-operator mutation
 * report (Issue #3971).
 *
 * Emitted alongside the existing per-generation `[Timing]` / `[Throughput]`
 * verbose lines rather than on a new output channel, so an operator watching a
 * run can see which mutation operators are actually surviving selection.
 */

import type { MutationOperatorReport } from "@neat/MutationOperatorReport.ts";

/** Format a number for the log line without a wall of decimals. */
function short(value: number): string {
  if (!Number.isFinite(value)) return String(value);
  if (value === 0) return "0";
  return Math.abs(value) >= 0.001 && Math.abs(value) < 1e6
    ? value.toFixed(4)
    : value.toExponential(2);
}

/**
 * Render one generation's per-operator telemetry as a single log line.
 *
 * Operators with no activity are omitted. The trailing summary states the
 * multi-operator attribution ambiguity in numbers: how many resolved offspring
 * carried more than one mutation.
 *
 * @param report - The generation's report.
 * @returns A single line, or `undefined` when nothing happened this generation.
 */
export function formatMutationOperatorReport(
  report: MutationOperatorReport,
): string | undefined {
  const parts: string[] = [];
  for (const [name, summary] of Object.entries(report.operators)) {
    if (summary.proposed === 0 && summary.evaluated === 0) continue;
    const fields = [
      `proposed=${summary.proposed}`,
      `noChange=${summary.noChange}`,
      `applied=${summary.applied}`,
      `reverted=${summary.reverted}`,
      `evaluated=${summary.evaluated}`,
      `accepted=${summary.accepted}`,
      `rejected=${summary.rejected}`,
      `evalMs=${Math.round(summary.evaluationMs)}`,
    ];
    const delta = summary.scoreDelta;
    if (delta) {
      fields.push(
        `delta[n=${delta.count} min=${short(delta.min)} med=${
          short(delta.median)
        } max=${short(delta.max)}]`,
      );
    }
    const buckets = summary.depthBuckets;
    if (summary.applied > 0) {
      fields.push(
        `depth[in=${buckets["input-adjacent"]} mid=${buckets["mid"]} out=${
          buckets["output-adjacent"]
        } ?=${buckets["unknown"]}]`,
      );
    }
    const outcomeDepth = (
      label: string,
      counts: Readonly<Record<string, number>>,
    ) => {
      const total = Object.values(counts).reduce((sum, n) => sum + n, 0);
      if (total === 0) return;
      fields.push(
        `${label}[in=${counts["input-adjacent"]} mid=${counts["mid"]} out=${
          counts["output-adjacent"]
        } ?=${counts["unknown"]}]`,
      );
    };
    outcomeDepth("depthAccepted", summary.acceptedDepthBuckets);
    outcomeDepth("depthRejected", summary.rejectedDepthBuckets);
    if (summary.coAttributed > 0) {
      fields.push(
        `attribution[sole=${summary.soleAttributed} co=${summary.coAttributed}]`,
      );
    }
    parts.push(`${name} ${fields.join(" ")}`);
  }

  if (parts.length === 0) return undefined;

  const { attribution, mcmc } = report;
  const summary = `resolved=${attribution.resolvedOffspring} ` +
    `multiOperator=${attribution.multiOperatorOffspring} ` +
    `discarded=${attribution.discardedOffspring} ` +
    `evalMs=${Math.round(attribution.evaluationMs)} ` +
    `mcmc=${mcmc.accepted}/${mcmc.proposed}`;

  return `[MutationOps] ${parts.join(" | ")} || ${summary}`;
}
