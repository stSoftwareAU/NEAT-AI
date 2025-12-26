import type { Creature } from "../Creature.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";

/**
 * Validate a creature immediately after applying discovery changes.
 *
 * Goal: fail fast near the discovery logic that introduced corruption, rather than
 * surfacing later during unrelated phases (e.g. breeding calling upgrade()).
 *
 * Forward-only is enforced when:
 * - the run is configured as forward-only (feedbackLoop !== true), OR
 * - the base creature is explicitly forwardOnly, OR
 * - the base creature is 4.x+ (4.x is a hard forward-only invariant).
 *
 * Notes (Australian English):
 * - This function is intentionally strict; any failure indicates a bug in our code,
 *   not a "bad creature".
 * - We include a small sample of recurrent violations to improve triage.
 */
export function validateAfterDiscoveryOrThrow(args: {
  /** The base creature the discovery change was applied to (usually the fittest). */
  baseCreature: Creature;
  /** The resulting creature after discovery modification. */
  discoveredCreature: Creature;
  /** Discovery session ID (for log correlation). */
  discoveryID: string;
  /** Human-readable operation label (e.g. "addHelpfulSynapses", "removeSynapse"). */
  operation: string;
  /** The config feedbackLoop flag for the current run. */
  feedbackLoop: boolean | undefined;
}): void {
  const {
    baseCreature,
    discoveredCreature,
    discoveryID,
    operation,
    feedbackLoop,
  } = args;

  const baseMajor = getMajorVersion(baseCreature.semanticVersion);
  const discoveredMajor = getMajorVersion(discoveredCreature.semanticVersion);

  // 4.x+ is a hard forward-only invariant. If either the base or the discovered
  // creature is already 4.x+, we must fail fast (no silent repair).
  const isHardForwardOnlyInvariant = baseMajor >= 4 || discoveredMajor >= 4;

  // Pre-4.x: it's valid for a creature to temporarily contain recurrent links even
  // in a forward-only run; we repair it (fix+re-validate), then bump to 4.x once
  // forward-only is confirmed.
  const shouldAttemptForwardOnlyRepair = !isHardForwardOnlyInvariant &&
    (feedbackLoop !== true || baseCreature.forwardOnly === true ||
      discoveredCreature.forwardOnly === true);

  try {
    if (isHardForwardOnlyInvariant) {
      creatureValidate(discoveredCreature, { forwardOnly: true });
      discoveredCreature.forwardOnly = true;
      bumpToFourIfForwardOnlyConfirmed(discoveredCreature);
      return;
    }

    if (shouldAttemptForwardOnlyRepair) {
      try {
        creatureValidate(discoveredCreature, { forwardOnly: true });
        discoveredCreature.forwardOnly = true;
        bumpToFourIfForwardOnlyConfirmed(discoveredCreature);
        return;
      } catch (_preFourValidationError) {
        // Try to repair the transient corruption, then validate again.
        discoveredCreature.fix({ forwardOnly: true });
        creatureValidate(discoveredCreature, { forwardOnly: true });
        discoveredCreature.forwardOnly = true;
        bumpToFourIfForwardOnlyConfirmed(discoveredCreature);
        return;
      }
    }

    // Recurrent mode (or forward-only not requested): just ensure general validity.
    creatureValidate(discoveredCreature);
  } catch (e) {
    const error = e as Error;
    const violations =
      (isHardForwardOnlyInvariant || shouldAttemptForwardOnlyRepair)
        ? sampleForwardOnlyViolations(discoveredCreature, 10)
        : [];

    const detail = violations.length > 0
      ? ` Violations(sample up to 10): ${violations.join(" | ")}`
      : "";

    throw new Error(
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
        }), ` +
        `hardInvariant=${isHardForwardOnlyInvariant}, attemptedRepair=${shouldAttemptForwardOnlyRepair}. ` +
        `Error=${error.name}: ${error.message}.${detail}`,
    );
  }
}

function getMajorVersion(version: string | undefined): number {
  if (!version) return 0;
  const major = Number.parseInt(version.split(".")[0], 10);
  return Number.isNaN(major) ? 0 : major;
}

function bumpToFourIfForwardOnlyConfirmed(creature: Creature): void {
  const major = getMajorVersion(creature.semanticVersion);
  if (major === 2 || major === 3) {
    creature.semanticVersion = "4.0.0";
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
