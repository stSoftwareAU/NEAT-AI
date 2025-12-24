import type { Neuron } from "../architecture/Neuron.ts";
import type { Synapse } from "../architecture/Synapse.ts";
import type { DiscoverRecord } from "../architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";
import { distributeElasticError } from "./ElasticDistribution.ts";

/**
 * Recording-time elasticity helpers.
 *
 * Explorer + discovery use `Creature.record()` / `Neuron.record()` to attribute
 * value-space error to upstream paths. Historically the record path distributed
 * error equally across inbound links, which can heavily over-attribute error to
 * saturated squashes (eg. ArcTan near ±π/2).
 *
 * These helpers mirror training-time behaviour:
 * - prefer “plastic” links (large activation => smaller weight change needed)
 * - use safe-zone gates to avoid pushing already saturated parents further
 *
 * Note: record-time uses *raw* creature weights and *raw* activations from the
 * forward pass (not adjusted weights/biases), because it is an attribution /
 * analysis path rather than a training update.
 */

export type RecordElasticLink = Readonly<{
  synapse: Synapse;
  fromNeuron: Neuron;
  fromActivation: number;
  fromValue: number;
  safeZoneFactor: number;
}>;

export function getOrComputeRecordValue(
  neuron: Neuron,
  discoverMap: Map<string, DiscoverRecord>,
): number {
  const existing = discoverMap.get(neuron.uuid);
  if (
    existing && typeof existing.value === "number" &&
    Number.isFinite(existing.value)
  ) {
    return existing.value;
  }

  const state = neuron.creature.state;
  const activations = state.activations;

  let value = neuron.bias;
  if (neuron.type === "input") {
    value = activations[neuron.index];
  } else if (neuron.type === "constant") {
    value = neuron.bias;
  } else {
    const inward = neuron.creature.inwardConnections(neuron.index);
    for (let i = inward.length; i--;) {
      const c = inward[i];
      if (c.from === c.to) continue;
      value += c.weight * activations[c.from];
    }
  }

  if (existing) {
    existing.value = value;
  } else {
    discoverMap.set(neuron.uuid, {
      activation: state.activations[neuron.index],
      errors: [],
      value,
    });
  }

  return value;
}

export function buildRecordElasticLinks(
  neuron: Neuron,
  inward: ReadonlyArray<Synapse>,
  discoverMap: Map<string, DiscoverRecord>,
  provisionalErrorPerLink: number,
  options?: Readonly<{
    includeInputNodes?: boolean;
  }>,
): RecordElasticLink[] {
  const includeInputNodes = options?.includeInputNodes ?? false;

  const state = neuron.creature.state;
  const activations = state.activations;

  const links: RecordElasticLink[] = [];
  for (let i = 0; i < inward.length; i++) {
    const c = inward[i];
    if (c.from === c.to) continue;
    if (!c.weight) continue;

    const fromNeuron = neuron.creature.neurons[c.from];
    if (
      includeInputNodes === false &&
      (fromNeuron.type === "input" || fromNeuron.type === "constant")
    ) {
      continue;
    }

    const fromActivation = activations[fromNeuron.index];
    const fromValue = c.weight * fromActivation;

    let safeZoneFactor = 1;
    if (fromNeuron.type !== "input" && fromNeuron.type !== "constant") {
      const squash = fromNeuron.findSquash();
      if (squash.safeZoneAdjustment) {
        const rawInput = getOrComputeRecordValue(fromNeuron, discoverMap);
        safeZoneFactor = squash.safeZoneAdjustment(
          rawInput,
          provisionalErrorPerLink,
          c.weight,
        );
      }
    }

    links.push({
      synapse: c,
      fromNeuron,
      fromActivation,
      fromValue,
      safeZoneFactor,
    });
  }

  return links;
}

/**
 * Distributes record-time error across inbound links using the same basic
 * elasticity heuristic as training time, but with record-time inputs.
 *
 * Returns the chosen links and per-link shares aligned to that link list.
 */
export function distributeRecordError(
  error: number,
  links: ReadonlyArray<RecordElasticLink>,
  options?: Readonly<{
    plankConstant?: number;
    /**
     * When true, if all safe-zone/activation scores are zero we still fall back
     * to an equal split (last resort).
     */
    allowEqualFallback?: boolean;
  }>,
): { links: ReadonlyArray<RecordElasticLink>; shares: number[] } {
  const plankConstant = options?.plankConstant ?? 1e-12;
  const allowEqualFallback = options?.allowEqualFallback ?? true;

  if (!Number.isFinite(error) || links.length === 0) {
    return { links, shares: new Array(links.length).fill(0) };
  }

  const meta = links.map((l) => ({
    activation: l.fromActivation,
    safeZoneFactor: l.safeZoneFactor,
  }));

  // If everything is blocked, `distributeElasticError` will equal-split. That’s
  // acceptable as a last resort, but we allow opting out for callers that want
  // to stop recursion instead.
  if (!allowEqualFallback) {
    let denom = 0;
    for (const m of meta) {
      denom += (m.activation * m.activation) *
        Math.max(0, Math.min(1, m.safeZoneFactor));
    }
    if (denom <= plankConstant) {
      return { links, shares: new Array(links.length).fill(0) };
    }
  }

  const shares = distributeElasticError(error, meta, { plankConstant });
  return { links, shares };
}
