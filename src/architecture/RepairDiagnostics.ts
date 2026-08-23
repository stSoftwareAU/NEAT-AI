/**
 * The single loud diagnostic emitted when a load path has to repair a creature.
 *
 * Issue #3845: `Upgrade.correct()` and `Creature.fromPersistedJSON()` used to run
 * the structural repair pass on every ingest, silently. On a valid, modern
 * genome carrying grafted `IF` structure that rewired 46 of 26,077 synapses off
 * their shared bias-1 constants and onto arbitrary input neurons — in a grafted
 * decision tree the leaf value **is** the weight on that constant — and cost
 * 90.7 % of the creature's score. Nothing said a word, so a fleet-wide outage
 * ran for over 24 hours before anyone looked here.
 *
 * Repair now fires only on an actual validation failure, and when it fires it
 * shouts. An invalid creature is a defect in whatever produced it, not a routine
 * condition to be patched over, so the diagnostic carries everything a responder
 * needs to chase it upstream: the validation rule that failed, the message
 * naming the offending neuron or synapse, the creature's identity and size, and
 * the producer tags.
 *
 * @module
 */

import type { Creature } from "@creature";
import { CreatureUtil } from "@architecture/CreatureUtils.ts";
import { ValidationError } from "@errors/ValidationError.ts";
import { getLogger } from "@utils/Logger.ts";

/** Longest tag value carried into the diagnostic before truncation. */
const TAG_VALUE_DIAGNOSTIC_LIMIT = 120;

/**
 * Render the creature-level tags that identify what produced a genome —
 * `forests`, `lamarck`, `intelligentDesign`, `Discovery`, `LEARN_HOST`,
 * `SAMPLER_HOST` and friends. They are the only breadcrumb back to the producer.
 */
export function describeProducer(creature: Creature): string {
  const tags = creature.tags;
  if (!tags || tags.length === 0) return "no producer tags";
  return tags
    .map(({ name, value }) => {
      const text = String(value ?? "");
      const clipped = text.length > TAG_VALUE_DIAGNOSTIC_LIMIT
        ? `${text.slice(0, TAG_VALUE_DIAGNOSTIC_LIMIT)}…`
        : text;
      return `${name}=${clipped}`;
    })
    .join(", ");
}

/**
 * The creature's identity, for the diagnostic only.
 *
 * Issue #3843: a persisted creature no longer adopts the uuid written beside it
 * in the file — a uuid that arrived from outside the process carries no
 * guarantee that the genome next to it is the one it was computed from — so
 * `creature.uuid` is undefined on this path until something asks for it.
 * Derive it, so the responder chasing this genome upstream gets the identity of
 * what actually arrived rather than what the file claimed.
 *
 * This runs only after a validation failure, so the hash is off any hot path.
 * It must never throw: the creature is already known to be invalid, and
 * `makeUUID` rejects a hidden neuron with no uuid.
 */
function describeIdentity(creature: Creature): string {
  try {
    return CreatureUtil.makeUUID(creature);
  } catch {
    return "unknown";
  }
}

/**
 * Shout about a creature that arrived needing repair.
 *
 * @param creature - The creature that failed validation.
 * @param error - The validation failure, ideally a {@link ValidationError}.
 * @param pass - The load path doing the repairing, named in the log line.
 */
export function shoutAboutRepair(
  creature: Creature,
  error: unknown,
  pass: string,
): void {
  const reason = error instanceof ValidationError ? error.reason : "OTHER";
  const message = error instanceof Error ? error.message : String(error);

  getLogger().error(
    `🚨 [${pass}] repairing an INVALID creature — this is an upstream defect, ` +
      `not a routine condition. ` +
      `rule=${reason} detail="${message}" ` +
      `uuid=${describeIdentity(creature)} ` +
      `semanticVersion=${creature.semanticVersion ?? "unknown"} ` +
      `input=${creature.input} output=${creature.output} ` +
      `neurons=${creature.neurons.length} synapses=${creature.synapses.length} ` +
      `producer[${describeProducer(creature)}]`,
  );
}
