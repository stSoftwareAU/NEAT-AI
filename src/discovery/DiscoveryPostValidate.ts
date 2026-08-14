import type { Creature } from "@creature";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import { DiscoveryError } from "@errors/DiscoveryError.ts";

/**
 * Validate a creature immediately after applying discovery changes.
 *
 * Fail fast near the discovery logic that introduced corruption, rather than
 * surfacing later during unrelated phases (e.g. breeding).
 *
 * Forward-only is enforced when the discovered creature is marked forwardOnly.
 * All creatures are 4.x; the forwardOnly flag is the source of truth.
 */
export function validateAfterDiscoveryOrThrow(args: {
  baseCreature: Creature;
  discoveredCreature: Creature;
  discoveryID: string;
  operation: string;
  feedbackLoop: boolean | undefined;
}): void {
  const {
    baseCreature,
    discoveredCreature,
    discoveryID,
    operation,
  } = args;

  const enforceForwardOnly = baseCreature.forwardOnly === true ||
    discoveredCreature.forwardOnly === true;

  try {
    if (enforceForwardOnly) {
      creatureValidate(discoveredCreature, { forwardOnly: true });
      discoveredCreature.forwardOnly = true;
    } else {
      creatureValidate(discoveredCreature);
    }
  } catch (e) {
    const error = e as Error;
    const violations = enforceForwardOnly
      ? sampleForwardOnlyViolations(discoveredCreature, 10)
      : [];

    const detail = violations.length > 0
      ? ` Violations(sample up to 10): ${violations.join(" | ")}`
      : "";

    throw new DiscoveryError(
      `[Discovery ${discoveryID}] CRITICAL: discovery operation '${operation}' produced an invalid creature. ` +
        `base=${
          baseCreature.uuid ?? "unknown"
        } (v${baseCreature.semanticVersion}, forwardOnly=${
          baseCreature.forwardOnly === true
        }), ` +
        `result=${
          discoveredCreature.uuid ?? "unknown"
        } (v${discoveredCreature.semanticVersion}, forwardOnly=${
          discoveredCreature.forwardOnly === true
        }). ` +
        `Error=${error.name}: ${error.message}.${detail}`,
      "INVALID_CREATURE",
    );
  }
}

function sampleForwardOnlyViolations(
  creature: Creature,
  limit: number,
): string[] {
  const out: string[] = [];
  const synapses = creature.synapses;
  for (let i = 0; i < synapses.length && out.length < limit; i++) {
    const s = synapses[i];
    if (s.from === s.to || s.from > s.to) {
      out.push(
        `${i}) ${s.from} (${
          creature.neurons[s.from]?.ID?.() ?? "?"
        }) -> ${s.to} (${creature.neurons[s.to]?.ID?.() ?? "?"})`,
      );
    }
  }
  return out;
}
