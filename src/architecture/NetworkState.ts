import { Network } from "./Network.ts";

class NodeState {
  // public errorResponsibility=0;
  // public errorProjected=0;

  // public derivative=0;
  // public totalDeltaBias=0;
  // public previousDeltaBias=0;
  public count=0;

  public totalValue =0;
  public totalWeightedSum=0;


}

export class ConnectionState {
  public eligibility = 0;
  public totalValue = 0;
  public count=0;
  public totalActivation = 0;

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
    if (this.network.input != input.length) {
      console.trace();
      throw `Input size missmatch, expected ${this.network.input} was: ${input.length}`;
    }

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
