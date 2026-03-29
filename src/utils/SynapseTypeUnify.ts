/**
 * When collapsing duplicate synapse rows that share the same (from,to) endpoints,
 * pick a single `type` field. Live creatures only allow one row per (from,to)
 * (`connectBatch`, `creatureValidate`); conflicting types indicate corruption
 * (Issue #2086).
 */
export type SynapseArmType = "positive" | "negative" | "condition" | undefined;

export function unifySynapseTypeForMerge(
  existing: SynapseArmType,
  incoming: SynapseArmType,
): SynapseArmType {
  if (existing === incoming) return existing;
  if (existing === undefined) return incoming;
  if (incoming === undefined) return existing;
  return existing;
}
