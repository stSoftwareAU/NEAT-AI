/**
 * Structural preconditions for an Intelligent Design squash substitution.
 *
 * Intelligent Design changes ONE field — a neuron's `squash` — and leaves the
 * topology alone. Most squashes are pure functions of the neuron's summed
 * input, so any neuron can take them. `IF` is not: `CreatureValidate` requires
 * an `IF` neuron to have at least three inward connections carrying all three
 * synapse roles (`condition`, `positive`, `negative`), and a substitution
 * cannot create either.
 *
 * Handing `IF` to a neuron that does not already satisfy that rule therefore
 * produces a creature the library's own validator refuses. GRQ#4283: an ID
 * worker was handed the same 5,050-neuron creature twice, three minutes apart,
 * and died both times before scoring a thing:
 *
 *     ValidationError: -1) 'IF' should have at least 3 inward connections was: 2
 *         at CreatureValidate.ts:165:15
 *         at validateOrDiagnose (…/utils/Diagnostics.ts:161:14)
 *         at WorkerProcessor.process (…/intelligentDesign/workers/WorkerProcessor.ts:50:7)
 *
 * `IF` reached the substitution table deliberately (GRQ#4157 added it, with
 * `MINIMUM` / `MAXIMUM`, for the tree/branching teams), so the answer is not to
 * remove it — it is to skip the neurons that cannot carry it and keep scanning.
 *
 * @module
 */

import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

/** Squash names whose validity depends on the neuron's inward topology. */
export const STRUCTURALLY_CONSTRAINED_SQUASHES: ReadonlySet<string> = new Set([
  "IF",
]);

/** The three synapse roles `CreatureValidate` requires of an `IF` neuron. */
const REQUIRED_IF_ROLES = ["condition", "positive", "negative"] as const;

/**
 * Why `neuronUuid` cannot adopt `nextSquash`, or `undefined` when it can.
 *
 * The returned string is a complete reason, ready to log as-is — the caller does
 * not need to know which rule was checked.
 *
 * @param creatureExport - The creature the substitution would be applied to.
 * @param neuronUuid - UUID of the neuron whose squash would change.
 * @param nextSquash - The squash the caller wants to apply.
 */
export function squashSubstitutionBlockedReason(
  creatureExport: CreatureExport,
  neuronUuid: string,
  nextSquash: string,
): string | undefined {
  if (!STRUCTURALLY_CONSTRAINED_SQUASHES.has(nextSquash)) return undefined;

  const inwardRoles: string[] = [];
  for (const synapse of creatureExport.synapses) {
    if (synapse.toUUID !== neuronUuid) continue;
    // An untyped synapse counts as "positive", matching CreatureValidate.
    inwardRoles.push(synapse.type ?? "positive");
  }

  if (inwardRoles.length < 3) {
    return `'${nextSquash}' needs at least 3 inward connections, neuron has ${inwardRoles.length}`;
  }

  const missing = REQUIRED_IF_ROLES.filter((role) =>
    !inwardRoles.includes(role)
  );
  if (missing.length > 0) {
    return `'${nextSquash}' needs inward connections of every role, neuron is missing: ${
      missing.join(", ")
    }`;
  }

  return undefined;
}

/** Convenience predicate over {@link squashSubstitutionBlockedReason}. */
export function canAdoptSquash(
  creatureExport: CreatureExport,
  neuronUuid: string,
  nextSquash: string,
): boolean {
  return squashSubstitutionBlockedReason(
    creatureExport,
    neuronUuid,
    nextSquash,
  ) === undefined;
}
