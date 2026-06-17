import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { SynapseExport } from "@architecture/SynapseInterfaces.ts";
import { normaliseCreatureExport } from "@architecture/NormaliseCreatureExport.ts";
import { computeConstantValues } from "@compact/ConstantFold.ts";

/**
 * Result of collapsing constant-conditioned IF neurons.
 */
export interface IfCollapseResult {
  /** Whether any IF neuron was collapsed. */
  changed: boolean;
  /** Number of IF neurons collapsed to a plain additive form. */
  collapsedIfs: number;
  /** Number of synapses removed (dead condition + untaken-branch edges). */
  removedSynapses: number;
}

/**
 * Exact IF-collapse for the **safe** compaction variant (Issue #3036).
 *
 * An IF neuron selects its branch by `condition = Σ(condition-type inbound
 * values)`, taking the positive branch when `condition > 0` else the negative
 * branch (see `src/methods/activations/aggregate/IF.ts`). The branch role of
 * each inbound synapse is read from its `type` field exactly as `IF.ts` reads
 * it — never from synapse ordering:
 *
 * - `type === "condition"` → contributes to the selector.
 * - `type === "negative"`  → negative branch.
 * - anything else (`"positive"` or no `type`) → positive branch (the IF
 *   activation's `default` case).
 *
 * When **every** condition-type input is constant, the selector is fixed at
 * compaction time, so the IF can be collapsed losslessly to its always-taken
 * branch:
 *
 * 1. Compute the fixed `condition = Σ(weightᵢ · constantᵢ)` over the
 *    condition synapses.
 * 2. The taken branch is `positive` if `condition > 0`, else `negative`.
 * 3. Keep only the taken branch's inbound synapses, stripping their `type`
 *    so they become ordinary additive edges; drop the condition synapses and
 *    the untaken branch's synapses.
 * 4. Rewrite the neuron's squash to `IDENTITY`. Its output then becomes
 *    `Σ(taken-branch values) + bias` — identical to the IF's always-taken
 *    result `(taken) + bias`.
 *
 * The resulting additive neuron (and any constants the collapse strands) is
 * left for a subsequent constant-fold round and orphan cleanup to absorb, so
 * this pass composes with the base fold without duplicating its work.
 *
 * Constants are detected with the same {@link computeConstantValues} routine as
 * the base fold, so a condition input that is a `type:"constant"` producer or a
 * hidden neuron that has become effectively constant both count.
 *
 * Safety rules:
 * - Only collapse when **all** condition synapses originate from
 *   (effectively) constant neurons; any varying condition input leaves the IF
 *   untouched.
 * - An IF with no condition synapses is malformed; it is left for the dedicated
 *   IF-repair pass rather than collapsed here.
 * - Frozen IF neurons, or IFs with any frozen inbound synapse, are never
 *   modified (Issue #1861).
 *
 * The export is modified in place.
 *
 * @param creatureExport - The CreatureExport to collapse (modified in place).
 * @returns Counts of collapsed IFs / removed synapses and whether anything changed.
 */
export function collapseConstantIf(
  creatureExport: CreatureExport,
): IfCollapseResult {
  normaliseCreatureExport(creatureExport);

  const inward = new Map<number, SynapseExport[]>();
  for (const s of creatureExport.synapses) {
    const list = inward.get(s.toId!);
    if (list) list.push(s);
    else inward.set(s.toId!, [s]);
  }

  const constValue = computeConstantValues(creatureExport.neurons, inward);

  const toDrop = new Set<SynapseExport>();
  let collapsedIfs = 0;

  for (const neuron of creatureExport.neurons) {
    if (neuron.squash !== "IF") continue;
    if (neuron.frozen) continue;

    const ins = inward.get(neuron.id!) ?? [];
    if (ins.some((s) => s.frozen)) continue;

    const conditionSynapses = ins.filter((s) => s.type === "condition");
    // A condition-less IF is malformed; leave it to the IF-repair pass.
    if (conditionSynapses.length === 0) continue;

    let allConst = true;
    let condition = 0;
    for (const s of conditionSynapses) {
      const v = constValue.get(s.fromId!);
      if (v === undefined) {
        allConst = false;
        break;
      }
      condition += s.weight * v;
    }
    if (!allConst) continue;

    // Branch roles mirror IF.ts: "negative" is explicit; everything that is
    // neither "condition" nor "negative" is the positive (default) branch.
    const keepNegative = condition <= 0;
    for (const s of ins) {
      const isNegative = s.type === "negative";
      const taken = keepNegative
        ? isNegative
        : !isNegative && s.type !== "condition";
      if (taken) {
        // Surviving branch edges become plain additive synapses.
        delete s.type;
      } else {
        toDrop.add(s);
      }
    }

    // Σ(taken-branch values) + bias via an ordinary additive neuron.
    neuron.squash = "IDENTITY";
    collapsedIfs++;
  }

  if (collapsedIfs === 0) {
    return { changed: false, collapsedIfs: 0, removedSynapses: 0 };
  }

  const before = creatureExport.synapses.length;
  creatureExport.synapses = creatureExport.synapses.filter(
    (s) => !toDrop.has(s),
  );
  const removedSynapses = before - creatureExport.synapses.length;

  delete creatureExport.memetic;

  return { changed: true, collapsedIfs, removedSynapses };
}
