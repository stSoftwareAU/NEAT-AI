import { Network } from "./Network.ts";
import { Node } from "./Node.ts";

class NodeState {
  public errorResponsibility: number;
  public errorProjected: number;

  constructor() {
    this.errorResponsibility = 0;
    this.errorProjected = 0;
  }
}

class NodeStatePersistent {
  public derivative: number;
  public totalDeltaBias: number;
  public previousDeltaBias: number;

  constructor() {
    this.derivative = 0;
    this.totalDeltaBias = 0;
    this.previousDeltaBias = 0;
  }
}

class ConnectionState {
  public eligibility: number;

  public xTrace: { nodes: Node[]; values: number[]; used?: boolean };

  constructor() {
    this.eligibility = 0;
    this.xTrace = {
      nodes: [],
      values: [],
    };
  }
}

class ConnectionStatePersistent {
  public previousDeltaWeight: number;
  public totalDeltaWeight: number;

  constructor() {
    this.previousDeltaWeight = 0;
    this.totalDeltaWeight = 0;
  }
}

export class NetworkState {
  private nodeMap;
  private connectionMap;
  private nodeMapPersistent;
  private connectionMapPersistent;
  private network;
  public activations: number[] = [];

  constructor(network: Network) {
    this.network = network;
    this.nodeMap = new Map<number, NodeState>();
    this.connectionMap = new Map<number, Map<number, ConnectionState>>();
    this.nodeMapPersistent = new Map<number, NodeStatePersistent>();
    this.connectionMapPersistent = new Map<
      number,
      Map<number, ConnectionStatePersistent>
    >();
  }

  connectionPersistent(from: number, to: number): ConnectionStatePersistent {
    let fromMap = this.connectionMapPersistent.get(from);
    if (fromMap === undefined) {
      fromMap = new Map<number, ConnectionStatePersistent>();
      this.connectionMapPersistent.set(from, fromMap);
    }
    const state = fromMap.get(to);

    if (state !== undefined) {
      return state;
    } else {
      const tmpState = new ConnectionStatePersistent();

      fromMap.set(to, tmpState);
      return tmpState;
    }
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

  nodePersistent(indx: number): NodeStatePersistent {
    const state = this.nodeMapPersistent.get(indx);

    if (state !== undefined) {
      return state;
    } else {
      const tmpState = new NodeStatePersistent();

      this.nodeMapPersistent.set(indx, tmpState);
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
