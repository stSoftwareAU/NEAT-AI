/* Import */
import { LOGISTIC } from "../methods/activations/types/LOGISTIC.ts";
import { Activations } from "../methods/activations/Activations.ts";
import { NodeActivationInterface } from "../methods/activations/NodeActivationInterface.ts";
import { NodeFixableInterface } from "../methods/activations/NodeFixableInterface.ts";
import { ActivationInterface } from "../methods/activations/ActivationInterface.ts";
import { Mutation } from "../methods/mutation.ts";
import { Connection } from "./Connection.ts";
import { addTags, TagsInterface } from "../tags/TagsInterface.ts";
import { NodeInterface } from "./NodeInterface.ts";
import { NetworkUtil } from "./NetworkUtil.ts";

export class Node implements TagsInterface, NodeInterface {
  readonly util: NetworkUtil;
  readonly type;
  bias: number;
  squash?: string;
  private squashMethodCache?: NodeActivationInterface | ActivationInterface;
  public index: number;
  public tags = undefined;

  constructor(
    type: "input" | "output" | "hidden" | "constant",
    bias: number | undefined,
    util: NetworkUtil,
    squash: string = LOGISTIC.NAME,
  ) {
    if (!type) {
      console.trace();
      throw "type must be defined: " + (typeof type);
    }

    if (type !== "input") {
      if (type !== "output" && type !== "hidden" && type !== "constant") {
        console.trace();
        throw "invalid type: " + type;
      }

      if (bias === undefined) {
        this.bias = Math.random() * 0.2 - 0.1;
      } else {
        if (!Number.isFinite(bias)) {
          console.trace();
          throw "bias (other than for 'input') must be a number type: " + type +
            ", typeof: " +
            (typeof bias) + ", value: " + bias;
        }
        this.bias = bias;
      }

      if (typeof squash !== "string") {
        console.trace();
        throw "squash (other than for " + type + ") must be a string typeof: " +
          (typeof squash) + ", value: " + squash;
      }
      this.squash = squash;
    } else {
      this.bias = Infinity;
    }

    if (typeof util !== "object") {
      console.trace();
      throw "util must be a NetworkUtil was: " + (typeof util);
    }

    this.util = util;

    this.type = type;

    this.index = -1;
  }

  findSquash() {
    if (!this.squashMethodCache) {
      this.squashMethodCache = Activations.find(
        this.squash ? this.squash : "UNDEFINED",
      );
    }
    return this.squashMethodCache;
  }

  fix() {
    delete this.squashMethodCache;

    if (this.type == "hidden") {
      const fromList = this.util.fromConnections(this.index);
      if (fromList.length == 0) {
        const gateList = this.util.gateConnections(this.index);
        {
          if (gateList.length == 0) {
            const targetIndx = Math.min(
              1,
              Math.floor(
                Math.random() * (this.util.nodeCount() - this.index),
              ),
            ) +
              this.index;
            this.util.connect(
              this.index,
              targetIndx,
              Connection.randomWeight(),
            );
          }
        }
      }
      const toList = this.util.toConnections(this.index);
      if (toList.length == 0) {
        const fromIndx = Math.floor(Math.random() * this.index);
        this.util.connect(
          fromIndx,
          this.index,
          Connection.randomWeight(),
        );
      }
    } else if (this.type == "output") {
      const toList = this.util.toConnections(this.index);
      if (toList.length == 0) {
        const fromIndx = Math.floor(
          Math.random() * (this.util.nodeCount() - this.util.outputCount()),
        );
        this.util.connect(
          fromIndx,
          this.index,
          Connection.randomWeight(),
        );
      }
    }

    if (this.squash) {
      const activation = this.findSquash();

      if (this.isFixableActivation(activation)) {
        activation.fix(this);
      }
    }
  }

  private isNodeActivation(
    activation: NodeActivationInterface | ActivationInterface,
  ): activation is NodeActivationInterface {
    return (activation as NodeActivationInterface).activate != undefined;
  }

  private isFixableActivation(
    activation:
      | NodeActivationInterface
      | ActivationInterface
      | NodeFixableInterface,
  ): activation is NodeFixableInterface {
    return (activation as NodeFixableInterface).fix != undefined;
  }

  getActivation() {
    const state = this.util.networkState.node(this.index);

    return state.activation;
  }

  /**
   * Activates the node
   */
  activate() {
    const state = this.util.networkState.node(this.index);

    const squashMethod = this.findSquash();

    if (this.isNodeActivation(squashMethod)) {
      state.activation = squashMethod.activate(this) + this.bias;
    } else {
      state.old = state.state;

      const toList = this.util.toConnections(this.index);
      let value = this.bias;

      for (let i = toList.length; i--;) {
        const c = toList[i];

        const fromState = this.util.networkState.node(c.from);
        const cs = this.util.networkState.connection(c.from, c.to);
        value += fromState.activation * c.weight * cs.gain;
      }

      const activationSquash = (squashMethod as ActivationInterface);
      const result = activationSquash.squashAndDerive(value);
      // Squash the values received
      state.activation = result.activation;
      if (!Number.isFinite(state.activation)) {
        if (state.activation === Number.POSITIVE_INFINITY) {
          state.activation = Number.MAX_SAFE_INTEGER;
        } else if (state.activation === Number.NEGATIVE_INFINITY) {
          state.activation = Number.MIN_SAFE_INTEGER;
        } else if (isNaN(state.activation)) {
          state.activation = 0;
        } else {
          console.trace();
          throw this.index + ") invalid value: + " + state.state +
            ", squash: " +
            this.squash +
            ", activation: " + state.activation;
        }
      }

      const sp = this.util.networkState.nodePersistent(this.index);
      sp.derivative = result.derivative;

      // Update traces
      const nodes: Node[] = [];
      const influences: number[] = [];

      const gateList = this.util.gateConnections(this.index);
      for (let i = gateList.length; i--;) {
        const c = gateList[i];
        const node = this.util.getNode(c.to);

        const pos = nodes.indexOf(node);
        if (pos > -1) {
          const fromState = this.util.networkState.node(c.from);
          influences[pos] += c.weight * fromState.activation;
        } else {
          nodes.push(node);
          const fromState = this.util.networkState.node(c.from);
          influences.push(
            c.weight * fromState.activation +
              (c.gater === this.index ? fromState.old : 0),
          );
        }
      }

      const self = this.util.selfConnection(this.index);
      const selfState = this.util.networkState.connection(
        this.index,
        this.index,
      );

      for (let i = 0; i < toList.length; i++) {
        const c = toList[i];
        const fromState = this.util.networkState.node(c.from);
        const cs = this.util.networkState.connection(c.from, c.to);
        if (self) {
          cs.eligibility =
            selfState.gain * self.weight * selfState.eligibility +
            fromState.activation * cs.gain;

          if (!Number.isFinite(cs.eligibility)) {
            if (cs.eligibility === Number.POSITIVE_INFINITY) {
              cs.eligibility = Number.MAX_SAFE_INTEGER;
            } else if (cs.eligibility === Number.NEGATIVE_INFINITY) {
              cs.eligibility = Number.MIN_SAFE_INTEGER;
            } else if (isNaN(cs.eligibility)) {
              cs.eligibility = 0;
            } else {
              console.trace();
              console.info(self, c, fromState.activation);
              throw c.from + ":" + c.to + ") invalid eligibility: " +
                cs.eligibility;
            }
          }
        } else {
          cs.eligibility = fromState.activation * cs.gain;
          if (!Number.isFinite(cs.eligibility)) {
            if (cs.eligibility === Number.POSITIVE_INFINITY) {
              cs.eligibility = Number.MAX_SAFE_INTEGER;
            } else if (cs.eligibility === Number.NEGATIVE_INFINITY) {
              cs.eligibility = Number.MIN_SAFE_INTEGER;
            } else if (isNaN(cs.eligibility)) {
              cs.eligibility = 0;
            } else {
              console.trace();
              console.info(c, fromState.activation);
              throw c.from + ":" + c.to + ") invalid eligibility: " +
                cs.eligibility;
            }
          }
        }

        // Extended trace
        for (let j = nodes.length; j--;) {
          const node = nodes[j];
          const influence = influences[j];

          const index = cs.xTrace.nodes.indexOf(node);

          if (index > -1) {
            const value = self
              ? (cs.gain *
                self.weight *
                cs.xTrace.values[index])
              : 0 +
                sp.derivative * cs.eligibility * influence;

            cs.xTrace.values[index] = value;
          } else {
            // Does not exist there yet, might be through mutation
            cs.xTrace.nodes.push(node);
            cs.xTrace.values.push(
              sp.derivative * cs.eligibility * influence,
            );
          }
        }
      }
    }

    return state.activation;
  }

  /**
   * Activates the node without calculating eligibility traces and such
   */
  noTraceActivate() {
    const state = this.util.networkState.node(this.index);

    const squashMethod = this.findSquash();
    if (this.isNodeActivation(squashMethod)) {
      state.activation = squashMethod.activate(this) + this.bias;
    } else {
      // All activation sources coming from the node itself

      const toList = this.util.toConnections(this.index);
      let value = this.bias;

      for (let i = toList.length; i--;) {
        const c = toList[i];
        const fromState = this.util.networkState.node(c.from);
        const cs = this.util.networkState.connection(c.from, c.to);
        value += fromState.activation * c.weight * cs.gain;
      }

      const activationSquash = (squashMethod as ActivationInterface);
      // Squash the values received
      state.activation = activationSquash.squash(value);

      if (!Number.isFinite(state.activation)) {
        if (state.activation === Number.POSITIVE_INFINITY) {
          state.activation = Number.MAX_SAFE_INTEGER;
        } else if (state.activation === Number.NEGATIVE_INFINITY) {
          state.activation = Number.MIN_SAFE_INTEGER;
        } else if (isNaN(state.activation)) {
          state.activation = 0;
        } else {
          const msg = this.index + ") invalid value:" + value +
            ", squash: " +
            this.squash +
            ", activation: " +
            state.activation;
          console.warn(msg);
          console.trace();
          state.activation = Number.MAX_SAFE_INTEGER;
        }
      }
    }

    return state.activation;
  }

  /**
   * Back-propagate the error, aka learn
   */
  propagate(rate: number, momentum: number, update: boolean, target?: number) {
    momentum = momentum || 0;
    rate = rate || 0.3;

    // Error accumulator
    let error = 0;

    const s = this.util.networkState.node(this.index);
    const sp = this.util.networkState.nodePersistent(this.index);
    // Output nodes get their error from the environment
    if (this.type === "output") {
      s.errorResponsibility = s.errorProjected = (target ? target : 0) -
        s.activation;
    } else { // the rest of the nodes compute their error responsibilities by back propagation
      // error responsibilities from all the connections projected from this node
      const fromList = this.util.fromConnections(this.index);

      for (let i = fromList.length; i--;) {
        const c = fromList[i];

        const toState = this.util.networkState.node(c.to);
        // Eq. 21
        const cs = this.util.networkState.connection(c.from, c.to);
        const tmpError = error +
          toState.errorResponsibility * c.weight * cs.gain;
        error = Number.isFinite(tmpError) ? tmpError : error;
      }

      // Projected error responsibility
      s.errorProjected = sp.derivative * error;

      if (!Number.isFinite(s.errorProjected)) {
        if (s.errorProjected === Number.POSITIVE_INFINITY) {
          s.errorProjected = Number.MAX_SAFE_INTEGER;
        } else if (s.errorProjected === Number.NEGATIVE_INFINITY) {
          s.errorProjected = Number.MIN_SAFE_INTEGER;
        } else if (isNaN(s.errorProjected)) {
          s.errorProjected = 0;
        } else {
          console.trace();
          // console.info(state.error, this.derivative, error);
          throw this.index + ") invalid error.projected: " + s.errorProjected;
        }
      }

      // Error responsibilities from all connections gated by this neuron
      error = 0;

      const gateList = this.util.gateConnections(this.index);
      for (let i = gateList.length; i--;) {
        const c = gateList[i];
        const toState = this.util.networkState.node(c.to);
        const self = this.util.selfConnection(this.index);
        let influence = self ? toState.old : 0;

        const fromState = this.util.networkState.node(c.from);
        influence += c.weight * fromState.activation;
        error += toState.errorResponsibility * influence;
      }

      // Gated error responsibility
      s.errorGated = sp.derivative * error;

      // Error responsibility
      s.errorResponsibility = s.errorProjected + s.errorGated;
    }

    if (this.type === "constant") {
      return;
    }

    // Adjust all the node's incoming connections
    const toList = this.util.toConnections(this.index);
    for (let i = toList.length; i--;) {
      const c = toList[i];

      const cs = this.util.networkState.connection(c.from, c.to);
      const csp = this.util.networkState.connectionPersistent(c.from, c.to);
      let gradient = s.errorProjected * cs.eligibility;

      for (let j = cs.xTrace.nodes.length; j--;) {
        const node = cs.xTrace.nodes[j];
        const value = cs.xTrace.values[j];
        const traceState = this.util.networkState.node(node.index);
        gradient += traceState.errorResponsibility * value;
      }

      // Adjust weight
      const deltaWeight = rate * gradient;

      csp.totalDeltaWeight += deltaWeight;
      if (update) {
        csp.totalDeltaWeight += momentum *
          csp.previousDeltaWeight;
        c.weight += csp.totalDeltaWeight;
        if (!Number.isFinite(c.weight)) {
          if (c.weight === Number.POSITIVE_INFINITY) {
            c.weight = Number.MAX_SAFE_INTEGER;
          } else if (c.weight === Number.NEGATIVE_INFINITY) {
            c.weight = Number.MIN_SAFE_INTEGER;
          } else if (isNaN(c.weight)) {
            c.weight = 0;
          } else {
            console.trace();
            throw c.from + ":" + c.to + ") invalid weight: " + c.weight;
          }
        }

        csp.previousDeltaWeight = csp.totalDeltaWeight;
        csp.totalDeltaWeight = 0;
      }
    }

    // Adjust bias
    const deltaBias = rate * s.errorResponsibility;
    sp.totalDeltaBias += deltaBias;
    if (update) {
      sp.totalDeltaBias += momentum * sp.previousDeltaBias;
      // if (this.bias !== undefined) {
      this.bias += sp.totalDeltaBias;
      if (!Number.isFinite(this.bias)) {
        if (this.bias === Number.POSITIVE_INFINITY) {
          this.bias = Number.MAX_SAFE_INTEGER;
        } else if (this.bias === Number.NEGATIVE_INFINITY) {
          this.bias = Number.MIN_SAFE_INTEGER;
        } else if (isNaN(this.bias)) {
          this.bias = 0;
        } else {
          console.trace();
          throw this.index + ") invalid this.bias: " + this.bias;
        }
      }
      // }
      sp.previousDeltaBias = sp.totalDeltaBias;
      sp.totalDeltaBias = 0;
    }
  }

  /**
   * Disconnects this node from the other node
   */
  disconnect(to: number, twoSided: boolean) {
    this.util.disconnect(this.index, to);
    if (twoSided) {
      this.util.disconnect(to, this.index);
    }
  }

  /**
   * Mutates the node with the given method
   */
  mutate(method: string) {
    if (typeof method !== "string") {
      console.trace();
      throw "Mutate method wrong type: " + (typeof method);
    }
    if (this.type == "input") {
      throw "Mutate on wrong node type: " + this.type;
    }
    switch (method) {
      case Mutation.MOD_ACTIVATION.name: {
        // Can't be the same squash
        while (true) {
          const tmpSquash = Activations
            .NAMES[Math.floor(Math.random() * Activations.NAMES.length)];

          if (tmpSquash != this.squash) {
            this.squash = tmpSquash;
            delete this.squashMethodCache;
            break;
          }
        }
        break;
      }
      case Mutation.MOD_BIAS.name: {
        const modification =
          Math.random() * (Mutation.MOD_BIAS.max - Mutation.MOD_BIAS.min) +
          Mutation.MOD_BIAS.min;
        this.bias = modification + this.bias;
        break;
      }
      default:
        console.trace();
        throw "Unknown mutate method: " + method;
    }
  }

  /**
   * Checks if this node is projecting to the given node
   */
  isProjectingTo(node: Node) {
    const c = this.util.getConnection(this.index, node.index);
    return c != null;
  }

  /**
   * Checks if the given node is projecting to this node
   */
  isProjectedBy(node: Node) {
    const c = this.util.getConnection(node.index, this.index);
    return c != null;
  }

  /**
   * Converts the node to a json object
   */
  toJSON() {
    if (this.type === "input") {
      return {
        type: this.type,
        tags: this.tags ? [...this.tags] : undefined,
      };
    } else {
      return {
        bias: this.bias,
        index: this.index,
        type: this.type,
        squash: this.squash,
        tags: this.tags ? [...this.tags] : undefined,
      };
    }
  }

  /**
   * Convert a json object to a node
   */
  static fromJSON(
    json: NodeInterface,
    util: NetworkUtil,
  ) {
    switch (json.type) {
      case "input":
      case "output":
      case "constant":
      case "hidden":
        break;
      default:
        throw "unknown type: " + json.type;
    }

    if (typeof util !== "object") {
      console.trace();
      throw "util must be a NetworkUtil was: " + (typeof util);
    }

    const node = new Node(json.type, json.bias, util);

    node.squash = json.squash;

    if (json.tags) {
      addTags(node, json);
    }
    return node;
  }
}
