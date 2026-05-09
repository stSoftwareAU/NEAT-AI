/**
 * Forward-only assertion helper (Issue #2500).
 *
 * Centralises the check that no recurrent synapse (`from >= to`) appears
 * on a creature flagged `forwardOnly === true`. Pipelines that produce
 * structures (mutation, breeding, discovery, coordinated structural
 * application) should call this helper at the corruption introduction
 * point so failures are caught **before** the creature reaches
 * `loadFrom`, where the synapse is silently stripped.
 */
import type { Creature } from "@creature";
import { TopologyError } from "@errors/TopologyError.ts";
import { neuronUuid } from "@neuron/NeuronSerialization.ts";

/**
 * Throws a {@link TopologyError} when `creature.forwardOnly === true`
 * and any synapse violates `from < to`.
 *
 * @param creature The creature to check.
 * @param source Short tag identifying the calling pipeline. Included in
 *   the thrown error message so the upstream stack frame can be
 *   identified from the message alone (e.g. logs, replays).
 */
export function assertNoRecurrentSynapseOnForwardOnly(
  creature: Creature,
  source: string,
): void {
  if (creature.forwardOnly !== true) return;
  const synapses = creature.synapses;
  if (!synapses || synapses.length === 0) return;
  for (let i = 0; i < synapses.length; i++) {
    const s = synapses[i];
    if (s.from >= s.to) {
      throw new TopologyError(
        `[${source}] Forward-only creature ${
          creature.uuid ?? "(no-uuid)"
        } has recurrent synapse at index ${i}: ${s.from}->${s.to}. ` +
          `This is the upstream corruption that produces ` +
          `'[loadFrom] Stripping recurrent synapse' warnings (Issue #2500).`,
        "INVALID_CONNECTION",
      );
    }
  }
}

/**
 * Throws a {@link TopologyError} when any synapse on `creature` resolves to
 * the same wire UUID on both endpoints — i.e. a self-loop in the exported
 * wire format that would survive `exportJSON()`.
 *
 * Issue #2618: positional `from < to` validation passes when two distinct
 * neurons (e.g. a demoted previous output and a freshly appended output)
 * share the same wire UUID (`output-N`). Once the creature is exported the
 * wire-format synapse collapses to `output-N -> output-N`, which downstream
 * pipelines (GRQ scorer, `loadFrom`) reject. Detect the collision at the
 * producer so the upstream stack frame is named.
 *
 * @param creature The creature to check.
 * @param source Short tag identifying the calling pipeline.
 */
export function assertNoWireSelfLoopOnForwardOnly(
  creature: Creature,
  source: string,
): void {
  if (creature.forwardOnly !== true) return;
  const synapses = creature.synapses;
  if (!synapses || synapses.length === 0) return;
  const neurons = creature.neurons;
  // Build wire uuid by position once. Inputs use `input-N`, outputs use
  // `output-N` (canonical), hidden/constant use their stored `uuid`.
  const wire = new Array<string | undefined>(neurons.length);
  for (let i = 0; i < neurons.length; i++) {
    const n = neurons[i];
    if (n.type === "input") {
      wire[i] = `input-${i}`;
    } else {
      try {
        wire[i] = neuronUuid(n);
      } catch {
        wire[i] = undefined;
      }
    }
  }

  const offending: string[] = [];
  for (let i = 0; i < synapses.length; i++) {
    const s = synapses[i];
    const f = wire[s.from];
    const t = wire[s.to];
    if (f !== undefined && t !== undefined && f === t) {
      offending.push(
        `${f}(${neurons[s.from].type})->${t}(${neurons[s.to].type})`,
      );
    }
  }
  if (offending.length > 0) {
    throw new TopologyError(
      `[${source}] Forward-only creature ${
        creature.uuid ?? "(no-uuid)"
      } has ${offending.length} wire-format self-loop synapse(s): ${
        offending.join("; ")
      }. Two distinct neurons share the same wire uuid; the cleaved or ` +
        `mutated creature will export as a self-loop and be rejected ` +
        `downstream (Issue #2618).`,
      "INVALID_CONNECTION",
    );
  }
}
