/**
 * The repair contract: a repair pass may never hand back something worse than
 * it was given (Issue #3848).
 *
 * #3845 stopped the bleeding by making the load-time repair a no-op when
 * `validate()` passes. That gate is a safety belt, not a fix: a *partly* invalid
 * creature — one broken rule out of thirty, on an otherwise excellent topology —
 * still went through the same blunt pass that cost a valid champion 90.7 % of
 * its score, and the gate would have waved it straight through to be mangled.
 *
 * This module rebuilds the repair path around the principles that outage taught:
 *
 * 1. **Never return something worse.** The result is probed before it is
 *    returned. A creature that could be activated when it arrived must still be
 *    activatable, with finite outputs, or the repair is refused
 *    ({@link RepairError} `BEHAVIOUR_LOST`).
 * 2. **Repair minimally and locally.** {@link applyTargetedRepair} dispatches per
 *    rule against the element `creatureValidate` actually named, rather than
 *    running every heuristic over the whole creature.
 * 3. **Preserve semantics you do not understand.** Role-typed edges into an `IF`
 *    are left alone unless a rule named that `IF`; moving one is refused
 *    ({@link RepairError} `ROLE_REWIRING`).
 * 4. **Substitution is not repair.** Every targeted repair removes or downgrades.
 *    None of them re-points an edge at a neuron of its choosing.
 * 5. **Be idempotent and auditable.** A creature that validates is returned
 *    untouched, so a second run is a no-op by construction, and every change is
 *    logged as *rule → element → action* beside a UUID-level structural diff.
 *
 * ```mermaid
 * flowchart TD
 *   A["creature arrives"] --> V{"creatureValidate"}
 *   V -- "valid" --> U["returned untouched"]
 *   V -- "invalid" --> S["shout: rule, element, producer"]
 *   S --> P["snapshot export + probe outputs"]
 *   P --> R{"rule has a targeted repair?"}
 *   R -- "yes" --> T["repair the named element only"] --> V2{"creatureValidate"}
 *   R -- "no" --> F["fall back to Creature.fix(), once"] --> V2
 *   V2 -- "invalid" --> R
 *   V2 -- "valid" --> C{"contract holds?"}
 *   C -- "role-typed edge moved on an unnamed IF" --> X["RepairError ROLE_REWIRING"]
 *   C -- "outputs lost or non-finite" --> Y["RepairError BEHAVIOUR_LOST"]
 *   C -- "yes" --> D["audit logged; creature returned"]
 * ```
 *
 * The legacy blunt pass is still reachable, for the rules that have no targeted
 * repair yet — but it now runs under the same verification as everything else,
 * so the #3845 damage is refused whichever pass produces it.
 *
 * @module
 */

import type { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import type { CreatureValidateOptions } from "@architecture/CreatureValidateMarshal.ts";
import { shoutAboutRepair } from "@architecture/RepairDiagnostics.ts";
import {
  buildProbeInputs,
  compareProbeOutputs,
  describeDeviation,
  probeOutputs,
} from "@architecture/BehaviourGuard.ts";
import { RepairError } from "@errors/RepairError.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import {
  auditRepair,
  describeRepairAudit,
  emptyRepairAudit,
  findRoleRewiring,
  type RepairAudit,
  repairChangedNothing,
} from "@repair/RepairAudit.ts";
import {
  applyTargetedRepair,
  describeRepairAction,
  type RepairAction,
} from "@repair/TargetedRepair.ts";
import { getLogger } from "@utils/Logger.ts";

/** What a verified repair did, and what it measured while doing it. */
export interface VerifiedRepairResult {
  /** False when the creature validated on arrival and was returned untouched. */
  repaired: boolean;
  /** The audit trail, one entry per rule the repair resolved. */
  actions: RepairAction[];
  /** UUID-level structural diff between what arrived and what is returned. */
  audit: RepairAudit;
  /** True when a rule had no targeted repair and the legacy pass was used. */
  fellBack: boolean;
}

/** Options controlling a verified repair. */
export interface VerifiedRepairOptions {
  /** The load path doing the repairing, named in every log line it emits. */
  pass: string;
  /** Forward-only expectation, passed through to `creatureValidate`. */
  forwardOnly?: boolean;
}

/**
 * Headroom above the neuron count for the repair loop.
 *
 * Every round either resolves a rule or stops the loop, and a resolved rule
 * removes or downgrades at least one element, so the loop terminates well
 * inside this. Exhausting it is not a silent truncation: the final
 * `creatureValidate` below then throws, naming the rule still unresolved.
 */
const ROUND_HEADROOM = 8;

/**
 * Repair `creature` in place, under a contract that refuses to make it worse.
 *
 * @param creature - The creature to verify and, if necessary, repair.
 * @param options - The naming and validation options for this load path.
 * @returns What the repair did; `repaired: false` when nothing needed doing.
 * @throws {ValidationError} When the creature is still invalid once every
 *   targeted repair and the legacy fallback have been spent — fail loud rather
 *   than return a creature that does not validate.
 * @throws {RepairError} When the repair produced something worse than it was
 *   given: role-typed structure moved on an `IF` no rule named, or outputs the
 *   creature used to produce were lost.
 */
export function verifiedRepair(
  creature: Creature,
  options: VerifiedRepairOptions,
): VerifiedRepairResult {
  const validateOptions: CreatureValidateOptions | undefined =
    options.forwardOnly === undefined
      ? undefined
      : { forwardOnly: options.forwardOnly };

  try {
    creatureValidate(creature, validateOptions);
    // Nothing to repair — hand the creature back exactly as it arrived.
    return {
      repaired: false,
      actions: [],
      audit: emptyRepairAudit(),
      fellBack: false,
    };
  } catch (e) {
    shoutAboutRepair(creature, e, options.pass);
  }

  const before = snapshot(creature);
  const baseline = captureBehaviourBaseline(creature);

  const actions: RepairAction[] = [];
  let fellBack = false;
  const rounds = creature.neurons.length + ROUND_HEADROOM;

  for (let round = 0; round < rounds; round++) {
    let failure: unknown;
    try {
      creatureValidate(creature, validateOptions);
      break;
    } catch (e) {
      failure = e;
    }

    const action = failure instanceof ValidationError
      ? applyTargetedRepair(creature, failure)
      : null;
    if (action) {
      actions.push(action);
      continue;
    }

    // No targeted repair for this rule. The legacy blunt pass is the only
    // remaining move; run it once, and only once — a second run would mean it
    // did not resolve the failure, and repeating it cannot help.
    if (fellBack) break;
    fellBack = true;
    actions.push({
      rule: failure instanceof ValidationError ? failure.reason : "OTHER",
      element: "creature",
      action:
        "no targeted repair for this rule — fell back to the legacy Creature.fix() pass",
    });
    creature.fix({ forwardOnly: options.forwardOnly });
  }

  // Fail loud: a creature that still breaks a rule is not repaired, and must
  // not be handed back as though it were.
  creatureValidate(creature, validateOptions);

  const after = snapshot(creature);
  const audit = before && after
    ? auditRepair(before, after)
    : emptyRepairAudit();

  verifyContract(creature, options.pass, actions, before, after, baseline);
  report(options.pass, actions, audit);

  return { repaired: true, actions, audit, fellBack };
}

/**
 * Export the creature for the audit, without letting `DEBUG` re-enter
 * validation on a creature already known to be broken.
 *
 * @returns The export, or `null` when the creature is too damaged to serialise —
 *   in which case there is nothing to diff and the structural half of the
 *   contract cannot be checked. The behaviour half and the final validation
 *   still are.
 */
function snapshot(creature: Creature): CreatureExport | null {
  const holdDebug = creature.DEBUG;
  creature.DEBUG = false;
  try {
    return creature.exportJSON();
  } catch {
    return null;
  } finally {
    creature.DEBUG = holdDebug;
  }
}

/** The probe rows and outputs a creature produced before it was repaired. */
export interface BehaviourBaseline {
  /** The deterministic rows both sides are measured on. */
  probes: Float32Array[];
  /** What the creature produced from them before the repair ran. */
  outputs: Float32Array[];
}

/**
 * Probe the creature as it arrived.
 *
 * A creature that cannot be activated at all — WASM unavailable, or damage bad
 * enough to trap — carries no behaviour contract to break, so the check is
 * skipped rather than guessed at. It is only the creature that *did* produce
 * finite outputs that is entitled to still produce them afterwards.
 *
 * @returns The baseline, or `null` when there is no contract to hold the repair to.
 */
export function captureBehaviourBaseline(
  creature: Creature,
): BehaviourBaseline | null {
  try {
    const probes = buildProbeInputs(creature.input);
    const outputs = probeOutputs(creature, probes);
    const finite = outputs.every((row) => row.every(Number.isFinite));
    return finite ? { probes, outputs } : null;
  } catch {
    return null;
  }
}

/**
 * Principles 3 and 4 — refuse a result that moved role-typed structure the pass
 * had no reason to touch.
 *
 * @param before - The creature as it arrived.
 * @param after - The creature the repair proposes to return.
 * @param justified - UUIDs of the neurons a failing rule actually named.
 * @param pass - The load path, named in the refusal.
 * @throws {RepairError} `ROLE_REWIRING` when the repair touched an unnamed `IF`.
 */
export function assertRoleStructurePreserved(
  before: CreatureExport,
  after: CreatureExport,
  justified: ReadonlySet<string>,
  pass: string,
): void {
  const violations = findRoleRewiring(before, after, justified);
  if (violations.length === 0) return;

  throw new RepairError(
    `[${pass}] repair refused: it rewired role-typed structure on an IF ` +
      `no failing rule named — in a grafted decision tree the leaf value ` +
      `is the weight on a bias-1 constant, so re-sourcing that edge ` +
      `fabricates a model. ${violations.length} violation(s): ` +
      `${violations.slice(0, ROLE_VIOLATION_SAMPLE).join("; ")}`,
    "ROLE_REWIRING",
  );
}

/** Longest run of role-rewiring violations quoted in the refusal message. */
const ROLE_VIOLATION_SAMPLE = 4;

/**
 * Principle 1 — refuse a result that lost outputs the creature used to produce.
 *
 * @param creature - The repaired creature.
 * @param baseline - What it produced before the repair, or `null` to skip.
 * @param pass - The load path, named in the refusal.
 * @throws {RepairError} `BEHAVIOUR_LOST` when the creature no longer activates
 *   to finite outputs of the same shape.
 */
export function assertBehaviourNotLost(
  creature: Creature,
  baseline: BehaviourBaseline | null,
  pass: string,
): void {
  if (!baseline) return;

  let deviationText: string;
  try {
    const outputs = probeOutputs(creature, baseline.probes);
    const deviation = compareProbeOutputs(baseline.outputs, outputs);
    if (!deviation.nonFinite) {
      getLogger().info(
        `[${pass}] repaired creature still activates — ${
          describeDeviation(deviation)
        }`,
      );
      return;
    }
    deviationText = describeDeviation(deviation);
  } catch (e) {
    deviationText = `activation failed: ${
      e instanceof Error ? e.message : String(e)
    }`;
  }

  throw new RepairError(
    `[${pass}] repair refused: the creature produced finite outputs before ` +
      `the repair and does not after — ${deviationText}`,
    "BEHAVIOUR_LOST",
  );
}

/**
 * Refuse a result that is worse than what arrived.
 *
 * @throws {RepairError} On either half of the contract.
 */
function verifyContract(
  creature: Creature,
  pass: string,
  actions: readonly RepairAction[],
  before: CreatureExport | null,
  after: CreatureExport | null,
  baseline: BehaviourBaseline | null,
): void {
  if (before && after) {
    // Only the `IF` neurons a failing rule actually named may have their
    // role-typed edges touched.
    const justified = new Set<string>();
    for (const action of actions) {
      if (action.neuronUuid) justified.add(action.neuronUuid);
    }
    assertRoleStructurePreserved(before, after, justified, pass);
  }

  assertBehaviourNotLost(creature, baseline, pass);
}

/** Put the audit trail on the record: rule → element → action, then the diff. */
function report(
  pass: string,
  actions: readonly RepairAction[],
  audit: RepairAudit,
): void {
  const trail = actions.length > 0
    ? actions.map(describeRepairAction).join(" | ")
    : "no rule needed a repair action";
  const changed = repairChangedNothing(audit)
    ? "the creature was left structurally identical"
    : describeRepairAudit(audit);

  getLogger().error(
    `🚨 [${pass}] repair complete — ${trail}. Changed: ${changed}`,
  );
}
