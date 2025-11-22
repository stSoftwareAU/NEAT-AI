import type { Creature } from "../Creature.ts";

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
  #shares: Map<string, number>;
  #inboundInfo: Map<number, InboundConnectionInfo>;
  #indexByUUID: Map<string, number>;

  constructor(creature: Creature) {
    this.#creature = creature;
    this.#indexByUUID = this.#buildIndexMap();
    this.#inboundInfo = this.#buildInboundInfo();
    this.#shares = this.#computeShares();
  }

  /**
   * Returns the share of total creature error that flows through the neuron.
   * Share is in the range [0, 1]. Unknown neurons return 0.
   */
  getNeuronShare(uuid?: string | null): number {
    if (!uuid) return 0;
    return this.#shares.get(uuid) ?? 0;
  }

  /**
   * Returns the share routed through a specific synapse. This is the neuron's
   * share multiplied by the fraction carried by the requested inbound synapse.
   */
  getSynapseShare(fromUUID?: string | null, toUUID?: string | null): number {
    if (!fromUUID || !toUUID) return 0;
    const toIndex = this.#findNeuronIndex(toUUID);
    const fromIndex = this.#findNeuronIndex(fromUUID);
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
    return this.getNeuronShare(toUUID) * fraction;
  }

  #computeShares(): Map<string, number> {
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

    const shareMap = new Map<string, number>();
    neurons.forEach((neuron, index) => {
      const share = Math.min(1, rawShares[index]);
      shareMap.set(neuron.uuid, share);
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

  #findNeuronIndex(uuid: string): number | undefined {
    return this.#indexByUUID.get(uuid);
  }

  #buildIndexMap(): Map<string, number> {
    const map = new Map<string, number>();
    this.#creature.neurons.forEach((neuron, index) => {
      map.set(neuron.uuid, index);
    });
    return map;
  }
}
