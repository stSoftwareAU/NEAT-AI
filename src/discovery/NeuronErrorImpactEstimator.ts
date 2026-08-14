/**
 * @module
 *
 * Estimates, per neuron, the largest share of the creature's total error that
 * neuron could remove if its own error went to zero — a cheap, purely
 * structural upper bound computed by walking backwards from the outputs and
 * splitting each neuron's error share across its inbound synapses in proportion
 * to their absolute weights.
 *
 * Discovery uses these shares to decide where structural change is worth
 * proposing: a neuron that can only influence a fraction of a percent of the
 * error is not worth a candidate. Reach for it when ranking neurons by
 * potential rather than by measured contribution — it needs only the topology
 * and weights, no forward pass or trace.
 */
import type { Creature } from "@creature";

const EPSILON = 1e-9;

interface InboundConnectionInfo {
  totalAbsWeight: number;
  connections: Array<{ fromIndex: number; weight: number }>;
}

/**
 * Estimates how much of the creature-level error can be influenced by each neuron.
 * The estimator walks backwards from the outputs, distributing error share across
 * inbound synapses proportionally to their absolute weights (falling back to equal
 * fractions when weights sum to ~0). The result is a conservative percentage in
 * the range [0, 1] describing the maximum potential error reduction a neuron can
 * contribute if its own error dropped by 100%.
 */
export class CreatureErrorImpactEstimator {
  #creature: Creature;
  #shares: Map<number, number>;
  #inboundInfo: Map<number, InboundConnectionInfo>;
  #indexById: Map<number, number>;

  constructor(creature: Creature) {
    this.#creature = creature;
    this.#indexById = this.#buildIndexMap();
    this.#inboundInfo = this.#buildInboundInfo();
    this.#shares = this.#computeShares();
  }

  /**
   * Returns the share of total creature error that flows through the neuron.
   * Share is in the range [0, 1]. Unknown neurons return 0.
   */
  getNeuronShare(id?: number | null): number {
    if (id === null || id === undefined) return 0;
    return this.#shares.get(id) ?? 0;
  }

  /**
   * Returns the share routed through a specific synapse. This is the neuron's
   * share multiplied by the fraction carried by the requested inbound synapse.
   */
  getSynapseShare(fromId?: number | null, toId?: number | null): number {
    if (
      fromId === null || fromId === undefined || toId === null ||
      toId === undefined
    ) return 0;
    const toIndex = this.#findNeuronIndex(toId);
    const fromIndex = this.#findNeuronIndex(fromId);
    if (toIndex === undefined || fromIndex === undefined) return 0;
    const inbound = this.#inboundInfo.get(toIndex);
    if (!inbound || inbound.connections.length === 0) {
      return 0;
    }
    const connection = inbound.connections.find((conn) =>
      conn.fromIndex === fromIndex
    );
    if (!connection) return 0;
    const fraction = this.#connectionFraction(inbound, connection.weight);
    if (fraction <= 0) return 0;
    return this.getNeuronShare(toId) * fraction;
  }

  #computeShares(): Map<number, number> {
    const neurons = this.#creature.neurons;
    if (!neurons || neurons.length === 0) {
      return new Map();
    }

    const outputIndices = neurons
      .map((neuron, index) => neuron.type === "output" ? index : -1)
      .filter((index) => index >= 0);

    if (outputIndices.length === 0) {
      return new Map();
    }

    const baseShare = 1 / outputIndices.length;
    const rawShares = new Array<number>(neurons.length).fill(0);

    const propagateShare = (
      index: number,
      share: number,
      pathVisited: Set<number>,
    ): void => {
      if (!Number.isFinite(share) || share <= 0) {
        return;
      }
      rawShares[index] += share;
      const inbound = this.#inboundInfo.get(index);
      if (!inbound || inbound.connections.length === 0) {
        return;
      }
      if (pathVisited.has(index)) {
        // Cycle detected. Stop propagating along this path to avoid infinite recursion.
        return;
      }
      pathVisited.add(index);
      for (const connection of inbound.connections) {
        const fraction = this.#connectionFraction(inbound, connection.weight);
        if (!Number.isFinite(fraction) || fraction <= 0) {
          continue;
        }
        propagateShare(
          connection.fromIndex,
          share * fraction,
          pathVisited,
        );
      }
      pathVisited.delete(index);
    };

    for (const outputIndex of outputIndices) {
      propagateShare(outputIndex, baseShare, new Set<number>());
    }

    const shareMap = new Map<number, number>();
    neurons.forEach((neuron, index) => {
      const share = Math.min(1, rawShares[index]);
      shareMap.set(neuron.id, share);
    });
    return shareMap;
  }

  #buildInboundInfo(): Map<number, InboundConnectionInfo> {
    const info = new Map<number, InboundConnectionInfo>();
    this.#creature.neurons.forEach((_neuron, index) => {
      const connections = this.#creature.inwardConnections(index)
        .map((synapse) => ({
          fromIndex: synapse.from,
          weight: synapse.weight,
        }));
      const totalAbsWeight = connections.reduce(
        (sum, conn) => sum + Math.abs(conn.weight),
        0,
      );
      info.set(index, { connections, totalAbsWeight });
    });
    return info;
  }

  #connectionFraction(
    inbound: InboundConnectionInfo,
    weight: number,
  ): number {
    if (inbound.connections.length === 0) return 0;
    if (inbound.totalAbsWeight > EPSILON) {
      return Math.abs(weight) / inbound.totalAbsWeight;
    }
    // All weights are ~0. Distribute evenly to avoid NaN.
    return 1 / inbound.connections.length;
  }

  #findNeuronIndex(id: number): number | undefined {
    return this.#indexById.get(id);
  }

  #buildIndexMap(): Map<number, number> {
    const map = new Map<number, number>();
    this.#creature.neurons.forEach((neuron, index) => {
      map.set(neuron.id, index);
    });
    return map;
  }
}
