import { Network } from "../architecture/Network.ts";
import { NetworkInternal } from "../architecture/NetworkInterfaces.ts";
import { Node } from "../architecture/Node.ts";
import { addTag, getTag, TagsInterface } from "../tags/TagsInterface.ts";

export interface CrisprInterface extends TagsInterface {
  id: string;
  mode: "append";

  nodes: {
    uuid?: string;
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
    network: NetworkInternal,
  ) {
    this.network = Network.fromJSON(
      (network as Network).internalJSON(),
    );
  }

  apply(dna: CrisprInterface): NetworkInternal {
    const tmpNetwork = Network.fromJSON(
      (this.network as Network).internalJSON(),
    );

    const UUIDs = new Set<string>();
    let alreadyProcessed = false;
    tmpNetwork.nodes.forEach((node) => {
      UUIDs.add(node.uuid ? node.uuid : "");
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
        }
        ((node as unknown) as { type: string }).type = "hidden";
        if (node.uuid?.startsWith("output-")) {
          node.uuid = crypto.randomUUID();
        }
      }
    });

    const adjustIndx = firstNetworkOutputIndex - firstDnaOutputIndex +
      dna.nodes.length;

    let outputIndx = 0;
    dna.nodes.forEach((dnaNode) => {
      let uuid: string;
      if (dnaNode.type == "output") {
        uuid = `output-${outputIndx}`;
        outputIndx++;
      } else {
        uuid = dnaNode.uuid
          ? UUIDs.has(dnaNode.uuid) ? crypto.randomUUID() : dnaNode.uuid
          : crypto.randomUUID();

        if (uuid.startsWith("output-")) {
          uuid = crypto.randomUUID();
        }
      }
      const indx = dnaNode.index + adjustIndx;

      const networkNode = new Node(
        uuid,
        dnaNode.type,
        dnaNode.bias,
        tmpNetwork,
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

      tmpNetwork.connect(from, to, c.weight, c.type);
    });
    return tmpNetwork;
  }
}
