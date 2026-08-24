/**
 * When collapsing duplicate synapse rows that share an identity, pick a single
 * `type` field. Into a non-`IF` target identity is still `(from, to)`
 * (`connectBatch`, `creatureValidate`); into an `IF` target it is
 * `(from, to, type)` and those rows are not collapsed (Issue #3873).
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
