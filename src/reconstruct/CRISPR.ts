import { NetworkInterface } from "../architecture/NetworkInterface.ts";
import { Network } from "../architecture/Network.ts";
import { Node } from "../architecture/Node.ts";
import { addTag, getTag, TagsInterface } from "../tags/TagsInterface.ts";
import { NetworkUtil } from "../architecture/NetworkUtil.ts";

export interface CrisprInterface extends TagsInterface {
  id: string;
  mode: "append";

  nodes: {
    index: number;
    type: "output";
    squash: string;
    bias: number;
  }[];

  connections: {
    from?: number;
    fromRelative?: number;
    to?: number;
    toRelative?: number;
    weight: number;
    type?: "positive" | "negative" | "condition";
  }[];
}

export class CRISPR {
  private network;

  constructor(
    network: NetworkInterface,
  ) {
    this.network = NetworkUtil.fromJSON((network as Network).util.toJSON());
  }

  apply(dna: CrisprInterface): NetworkInterface {
    const tmpNetwork = NetworkUtil.fromJSON(
      (this.network as Network).util.toJSON(),
    );

    let alreadyProcessed = false;
    tmpNetwork.nodes.forEach((node) => {
      const id = getTag(node, "CRISPR");

      if (id === dna.id) {
        alreadyProcessed = true;
      }
    });

    if (alreadyProcessed) return tmpNetwork;

    let firstDnaOutputIndex = -1;
    dna.nodes.forEach((node) => {
      if (node.type == "output") {
        if (firstDnaOutputIndex == -1) {
          firstDnaOutputIndex = node.index;
        }
      }
    });
    let firstNetworkOutputIndex = -1;
    tmpNetwork.nodes.forEach((node, indx) => {
      if (node.type == "output") {
        if (firstNetworkOutputIndex == -1) {
          firstNetworkOutputIndex = indx;
          ((node as unknown) as { type: string }).type = "hidden";
        }
      }
    });

    const adjustIndx = firstNetworkOutputIndex - firstDnaOutputIndex +
      dna.nodes.length;

    dna.nodes.forEach((dnaNode) => {
      const indx = dnaNode.index + adjustIndx;
      const networkNode = new Node(
        dnaNode.type,
        dnaNode.bias,
        tmpNetwork.util,
        dnaNode.squash,
      );
      networkNode.index = indx;

      addTag(networkNode, "CRISPR", dna.id);
      tmpNetwork.nodes.push(networkNode);
      if (dnaNode.type == "output") {
        if (firstDnaOutputIndex == -1) {
          firstDnaOutputIndex = indx;
        }
      }
    });

    dna.connections.forEach((c) => {
      const from = c.from !== undefined
        ? c.from
        : ((c.fromRelative ? c.fromRelative : 0) + adjustIndx);
      if (from == undefined) throw "invalid connection " + c;
      const to = c.to !== undefined
        ? c.to
        : ((c.toRelative ? c.toRelative : 0) + adjustIndx);
      if (to == undefined) throw "invalid connection " + c;
      console.info(c);
      tmpNetwork.util.connect(from, to, c.weight, c.type);
    });
    return tmpNetwork;
  }
}
