import { Network } from "./Network.ts";

class NodeState {
  public errorResponsibility: number;
  public errorProjected: number;

  public derivative: number;
  public totalDeltaBias: number;
  public previousDeltaBias: number;

  constructor() {
    this.errorResponsibility = 0;
    this.errorProjected = 0;
    this.derivative = 0;
    this.totalDeltaBias = 0;
    this.previousDeltaBias = 0;    
  }
}

class ConnectionState {
  public eligibility: number;
  public previousDeltaWeight: number;
  public totalDeltaWeight: number;

  public used?: boolean;

  constructor() {
    this.eligibility = 0;
    this.previousDeltaWeight = 0;
    this.totalDeltaWeight = 0;
  }
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
      for (let indx = input.length; indx--;) {
        this.activations[indx] = input[indx];
      }
    }
  }

  clear() {
    this.nodeMap.clear();
    this.connectionMap.clear();
    this.activations.length = 0;
  }
}
