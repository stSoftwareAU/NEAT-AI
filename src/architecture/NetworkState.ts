import { Network } from "./Network.ts";

export class NodeState {
  public count = 0;

  public totalValue = 0;
  public totalWeightedSum = 0;
  // public totalError = 0;
}

export class ConnectionState {
  public totalValue = 0;
  public count = 0;
  public totalActivation = 0;
  // public absoluteActivation = 0;

  public used?: boolean;
}

export class NetworkState {
  private nodeMap;
  private connectionMap;
  private network;
  public activations: number[] = [];

  constructor(network: Network) {
    this.network = network;
    this.nodeMap = new Map<number, NodeState>();
    this.connectionMap = new Map<number, Map<number, ConnectionState>>();
  }

  connection(from: number, to: number): ConnectionState {
    let fromMap = this.connectionMap.get(from);
    if (fromMap === undefined) {
      fromMap = new Map<number, ConnectionState>();
      this.connectionMap.set(from, fromMap);
    }
    const state = fromMap.get(to);

    if (state !== undefined) {
      return state;
    } else {
      const tmpState = new ConnectionState();

      fromMap.set(to, tmpState);
      return tmpState;
    }
  }

  node(indx: number): NodeState {
    const state = this.nodeMap.get(indx);

    if (state !== undefined) {
      return state;
    } else {
      const tmpState = new NodeState();

      this.nodeMap.set(indx, tmpState);
      return tmpState;
    }
  }

  makeActivation(input: number[], feedbackLoop: boolean) {
    if (this.activations.length == 0 || feedbackLoop == false) {
      this.activations = input.slice();
      this.activations.length = this.network.nodes.length;
      this.activations.fill(0, input.length);
    } else if (feedbackLoop) {
      /** Leave the results from last run */
      const rightArray = this.activations.slice(input.length);
      this.activations = input.concat(rightArray);
    }
  }

  clear() {
    this.nodeMap.clear();
    this.connectionMap.clear();
    this.activations.length = 0;
  }
}
