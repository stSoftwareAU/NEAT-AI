/**
 * @module
 *
 * The identity of a synapse — `(from, to, type)` — and the one rule that
 * relaxes it (Issue #3873).
 *
 * A synapse into an `IF` neuron carries a role (`condition`, `positive`,
 * `negative`) and the kernel keeps a **separate sum per role**:
 *
 * ```text
 * if (condition_sum > 0) positive_sum + bias else negative_sum + bias
 * ```
 *
 * So a term that must apply whichever way the `IF` branches needs two synapses
 * into that neuron from one source — one `positive`, one `negative`. Keying by
 * the ordered `(from, to)` pair forbade that, and the workaround was an
 * IDENTITY relay neuron whose only job was to be a second distinct source.
 *
 * Uniqueness is therefore the `(from, to, type)` triple, and the canonical sort
 * order is the same triple so it stays total. **Only an `IF` target may carry
 * more than one role from one source**: every other squash sums its inward
 * synapses regardless of role, so two synapses from one source there are
 * exactly one with the summed weight — redundancy with no meaning, which
 * evolution must not be able to create.
 *
 * These rules are NEAT-AI-core's (`validate_no_duplicate_synapses`,
 * `creature_validate` rules 25/26, core Issue #577); this module is the single
 * TypeScript home for the same key so the two engines agree by construction.
 */
import { getSynapseTypeCode } from "@wasm/CompileToWasm.ts";
import type { SynapseInternal } from "@architecture/SynapseInterfaces.ts";

/** The role a synapse plays at its target. `undefined` is the untyped role. */
export type SynapseRole = "positive" | "negative" | "condition";

/**
 * Number of distinct roles an ordered `(from, to)` pair may carry — the untyped
 * role plus `condition`, `negative` and `positive`. A pair may therefore appear
 * at most four times, and only into an `IF` target.
 */
export const SYNAPSE_ROLE_COUNT = 4;

/**
 * Canonical rank of a synapse role, used as the third component of the sort
 * key and the low digits of the connection-set key.
 *
 * Delegates to {@link getSynapseTypeCode} so the ordering is NEAT-AI-core's
 * `SynapseType` discriminant (`standard` 0, `condition` 1, `negative` 2,
 * `positive` 3) and cannot drift from it.
 */
export function synapseRoleRank(type?: SynapseRole): number {
  return getSynapseTypeCode(type);
}

/**
 * Compare two synapses in canonical `(from, to, type)` order.
 *
 * Total: two synapses compare equal only when all three components match, and
 * a creature may not carry two such synapses at all.
 */
export function compareSynapses(
  a: Pick<SynapseInternal, "from" | "to" | "type">,
  b: Pick<SynapseInternal, "from" | "to" | "type">,
): number {
  if (a.from !== b.from) return a.from - b.from;
  if (a.to !== b.to) return a.to - b.to;
  return synapseRoleRank(a.type) - synapseRoleRank(b.type);
}

/**
 * Whether the neuron at `toIndx` reads its inward synapses per role, and so may
 * be fed more than once by a single source.
 *
 * `IF` is the only such squash. An index outside the neuron array is not an
 * `IF` neuron — the dangling reference is reported by validation itself.
 */
export function isRoleReadingTarget(
  neurons: ReadonlyArray<{ squash?: string }>,
  toIndx: number,
): boolean {
  return neurons[toIndx]?.squash === "IF";
}

/** The role's name as it reads in an error message; `undefined` is `standard`. */
export function synapseRoleLabel(type?: SynapseRole): string {
  return type ?? "standard";
}

/**
 * The message for a second role from one source into a target that cannot read
 * roles apart — every squash but `IF` sums its inward synapses regardless of
 * role, so the pair says nothing a single summed synapse could not.
 */
export function nonIfSecondRoleMessage(
  from: number,
  to: number,
  existing: SynapseRole | undefined,
  wanted: SynapseRole | undefined,
  squash?: string,
): string {
  return `Synapse ${from}->${to} already carries the '${
    synapseRoleLabel(existing)
  }' role and ${to} is not an 'IF' neuron (squash '${
    squash ?? "unknown"
  }'), so it cannot also carry '${
    synapseRoleLabel(wanted)
  }' — sum the weights into one synapse instead`;
}
