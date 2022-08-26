import { Node } from "./Node.ts";

class NodeState {
  public errorResponsibility: number;
  public errorProjected: number;
  public errorGated: number;
  public old: number;
  public state: number;
  public activation: number;

  constructor() {
    this.errorResponsibility = 0;
    this.errorProjected = 0;
    this.errorGated = 0;
    this.old = 0;
    this.state = 0;
    this.activation = 0;
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
  public elegibility: number;
  public gain: number;

  public xtrace: { nodes: Node[]; values: number[] };

  constructor() {
    this.elegibility = 0;
    this.gain = 1; // gate only
    this.xtrace = {
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
  constructor() {
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
    // if (!Number.isInteger(indx) || indx < 0) {
    //   throw "Invalid index: " + indx;
    // }
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
    // if (!Number.isInteger(indx) || indx < 0) {
    //   throw "Invalid index: " + indx;
    // }
    const state = this.nodeMap.get(indx);

    if (state !== undefined) {
      return state;
    } else {
      const tmpState = new NodeState();

      this.nodeMap.set(indx, tmpState);
      return tmpState;
    }
  }

  clear(input: number) {
    // if (!Number.isInteger(input) || input < 1) {
    //   throw "Invalid input was: " + input;
    // }
    this.nodeMap.clear();

    for (const from of this.connectionMap.keys()) {
      if (from >= input) {
        this.connectionMap.delete(from);
      }
    }
  }
}
