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

export class NetworkState {
  public nodes: NodeState[];

  constructor(len: number) {
    if (!Number.isInteger(len)) {
      throw "Must be a integer was: " + len;
    }

    this.nodes = new Array(len);
    for (let i = len; i--;) {
      this.nodes[i] = new NodeState();
    }
  }
}
