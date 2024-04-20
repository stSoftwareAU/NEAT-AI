import { assert } from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  addTag,
  getTag,
  TagsInterface,
} from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { Neuron } from "../architecture/Neuron.ts";
import { Creature } from "../Creature.ts";

export interface CrisprInterface extends TagsInterface {
  id: string;
  mode: "insert" | "append";

  neurons?: {
    uuid?: string;
    index: number;
    type: "output";
    squash: string;
    bias: number;
  }[];

  synapses: {
    from?: number;
    fromRelative?: number;
    fromUUID?: string;
    to?: number;
    toRelative?: number;
    toUUID?: string;
    weight: number;
    type?: "positive" | "negative" | "condition";
  }[];
}

export class CRISPR {
  private creature;

  constructor(
    creature: Creature,
  ) {
    this.creature = Creature.fromJSON(
      creature.internalJSON(),
    );
  }

  private append(dna: CrisprInterface) {
    const tmpCreature = Creature.fromJSON(
      this.creature.exportJSON(),
    );

    const UUIDs = new Map<string, number>();
    let alreadyProcessed = false;
    tmpCreature.neurons.forEach((node) => {
      assert(node.uuid !== undefined, "missing uuid");

      UUIDs.set(node.uuid, node.index);
      const id = getTag(node, "CRISPR");

      if (id === dna.id) {
        alreadyProcessed = true;
      }
    });

    if (!alreadyProcessed) {
      tmpCreature.synapses.forEach((synapse) => {
        const id = getTag(synapse, "CRISPR");

        if (id === dna.id) {
          alreadyProcessed = true;
        }
      });
    }
    if (alreadyProcessed) return tmpCreature;

    if (dna.neurons) {
      let firstDnaOutputIndex: number = -1;
      dna.neurons.forEach((neuron) => {
        if (neuron.type == "output") {
          if (firstDnaOutputIndex == -1 && neuron.index !== undefined) {
            firstDnaOutputIndex = neuron.index;
          }
        }
      });

      let firstNetworkOutputIndex: number = -1;
      tmpCreature.neurons.forEach((neuron, indx) => {
        if (neuron.type == "output") {
          if (firstNetworkOutputIndex == -1) {
            firstNetworkOutputIndex = indx;
          }
          ((neuron as unknown) as { type: string }).type = "hidden";
          if (neuron.uuid?.startsWith("output-")) {
            neuron.uuid = crypto.randomUUID();
          }
        }
      });

      const adjustIndx = firstNetworkOutputIndex - firstDnaOutputIndex +
        dna.neurons.length;

      let outputIndx: number = 0;
      dna.neurons.forEach((dnaNeuron) => {
        let uuid: string;
        if (dnaNeuron.type == "output") {
          uuid = `output-${outputIndx}`;
          outputIndx++;
        } else {
          uuid = dnaNeuron.uuid
            ? UUIDs.has(dnaNeuron.uuid) ? crypto.randomUUID() : dnaNeuron.uuid
            : crypto.randomUUID();

          if (uuid.startsWith("output-")) {
            uuid = crypto.randomUUID();
          }
        }
        const indx = dnaNeuron.index + adjustIndx;

        const networkNode = new Neuron(
          uuid,
          dnaNeuron.type,
          dnaNeuron.bias,
          tmpCreature,
          dnaNeuron.squash,
        );
        networkNode.index = indx;

        addTag(networkNode, "CRISPR", dna.id);
        tmpCreature.neurons.push(networkNode);
        if (dnaNeuron.type == "output") {
          if (firstDnaOutputIndex == -1) {
            firstDnaOutputIndex = indx;
          }
        }
      });

      dna.synapses.forEach((c) => {
        const from = c.from !== undefined
          ? c.from
          : ((c.fromRelative ? c.fromRelative : 0) + adjustIndx);
        assert(
          from !== undefined,
          "Invalid connection (from): " + JSON.stringify(c),
        );

        const to = c.to !== undefined
          ? c.to
          : ((c.toRelative ? c.toRelative : 0) + adjustIndx);

        assert(
          to !== undefined,
          "Invalid connection (to): " + JSON.stringify(c),
        );

        tmpCreature.connect(from, to, c.weight, c.type);
      });
    }

    dna.synapses.forEach((c) => {
      let toIndx: number = -1;
      if (c.toUUID) {
        const indx = UUIDs.get(c.toUUID);
        assert(indx !== undefined, "missing toUUID " + c.toUUID);
        toIndx = indx;
      }

      let fromIndx: number = -1;
      if (c.fromUUID) {
        const indx = UUIDs.get(c.fromUUID);
        assert(indx !== undefined, "missing fromUUID " + c.fromUUID);
        fromIndx = indx;
      }

      if (fromIndx !== -1 && toIndx !== -1) {
        if (!tmpCreature.getSynapse(fromIndx, toIndx)) {
          const synapse = tmpCreature.connect(
            fromIndx,
            toIndx,
            c.weight,
            c.type,
          );
          addTag(synapse, "CRISPR", dna.id);
        }
      }
    });

    return tmpCreature;
  }

  private insert(dna: CrisprInterface) {
    const exportJSON = this.creature.exportJSON();
    const tmpCreature = Creature.fromJSON(
      exportJSON,
    );

    tmpCreature.synapses = [];

    const uuidMap = new Map<string, number>();

    let alreadyProcessed = false;
    tmpCreature.neurons.forEach((node) => {
      assert(node.uuid !== undefined, "missing uuid");

      const id = getTag(node, "CRISPR");

      if (id === dna.id) {
        alreadyProcessed = true;
      }
    });

    if (!alreadyProcessed) {
      tmpCreature.synapses.forEach((synapse) => {
        const id = getTag(synapse, "CRISPR");

        if (id === dna.id) {
          alreadyProcessed = true;
        }
      });
    }
    if (alreadyProcessed) return tmpCreature;

    if (dna.neurons) {
      let firstDnaOutputIndex: number = -1;
      dna.neurons.forEach((neuron) => {
        if (neuron.type == "output") {
          if (firstDnaOutputIndex == -1 && neuron.index !== undefined) {
            firstDnaOutputIndex = neuron.index;
          }
        }
      });

      let firstNetworkOutputIndex: number = -1;
      tmpCreature.neurons.forEach((neuron, indx) => {
        if (neuron.type == "output") {
          if (firstNetworkOutputIndex == -1) {
            firstNetworkOutputIndex = indx;
          }
        }

        if (neuron.uuid && neuron.type !== "output") {
          uuidMap.set(neuron.uuid, indx);
        }
      });

      const adjustIndx = firstNetworkOutputIndex - firstDnaOutputIndex +
        dna.neurons.length;

      let outputIndx: number = 0;
      dna.neurons.forEach((dnaNeuron) => {
        let uuid: string;
        if (dnaNeuron.type == "output") {
          uuid = `output-${outputIndx}`;
          outputIndx++;
        } else {
          uuid = dnaNeuron.uuid
            ? uuidMap.has(dnaNeuron.uuid) ? crypto.randomUUID() : dnaNeuron.uuid
            : crypto.randomUUID();
          uuidMap.set(uuid, uuidMap.size);
          if (uuid.startsWith("output-")) {
            uuid = crypto.randomUUID();
          }
        }

        const indx = tmpCreature.neurons.length - tmpCreature.output;

        const networkNode = new Neuron(
          uuid,
          dnaNeuron.type,
          dnaNeuron.bias,
          tmpCreature,
          dnaNeuron.squash,
        );
        networkNode.index = indx;

        addTag(networkNode, "CRISPR", dna.id);

        tmpCreature.neurons.splice(indx, 0, networkNode);

        if (dnaNeuron.type == "output") {
          if (firstDnaOutputIndex == -1) {
            firstDnaOutputIndex = indx;
          }
        } else {
          uuidMap.set(uuid, indx);
        }
      });
      for (let i = 0; i < tmpCreature.output; i++) {
        uuidMap.set(`output-${i}`, uuidMap.size);
      }

      dna.synapses.forEach((c) => {
        let fromIndx: number | undefined = undefined;
        if (c.from !== undefined) {
          fromIndx = c.from;
        } else if (c.fromRelative) {
          fromIndx = c.fromRelative + adjustIndx;
        } else if (c.fromUUID) {
          const tmpIndx = uuidMap.get(c.fromUUID);
          if (tmpIndx !== undefined) {
            fromIndx = tmpIndx;
          }
        }

        assert(
          fromIndx !== undefined,
          "Invalid connection (from): " + JSON.stringify(c),
        );

        let toIndx: number | undefined = undefined;
        if (c.to !== undefined) {
          toIndx = c.to;
        } else if (c.toRelative) {
          toIndx = c.toRelative + adjustIndx;
        } else if (c.toUUID) {
          const tmpIndx = uuidMap.get(c.toUUID);
          if (tmpIndx !== undefined) {
            toIndx = tmpIndx;
          }
        }

        assert(
          toIndx !== undefined,
          "Invalid connection (to): " + JSON.stringify(c),
        );

        tmpCreature.connect(fromIndx, toIndx, c.weight, c.type);
      });
    }

    dna.synapses.forEach((c) => {
      let toIndx: number = -1;
      if (c.toUUID) {
        const indx = uuidMap.get(c.toUUID);
        assert(indx !== undefined, "missing toUUID " + c.toUUID);
        toIndx = indx;
      }

      let fromIndx: number = -1;
      if (c.fromUUID) {
        const indx = uuidMap.get(c.fromUUID);
        assert(indx !== undefined, "missing fromUUID " + c.fromUUID);
        fromIndx = indx;
      }

      if (fromIndx !== -1 && toIndx !== -1) {
        if (!tmpCreature.getSynapse(fromIndx, toIndx)) {
          const synapse = tmpCreature.connect(
            fromIndx,
            toIndx,
            c.weight,
            c.type,
          );
          addTag(synapse, "CRISPR", dna.id);
        }
      }
    });

    exportJSON.synapses.forEach((synapse) => {
      const fromIndx = uuidMap.get(synapse.fromUUID);
      const toIndx = uuidMap.get(synapse.toUUID);
      if (fromIndx !== undefined && toIndx !== undefined) {
        tmpCreature.connect(fromIndx, toIndx, synapse.weight, synapse.type);
      }
    });

    return tmpCreature;
  }

  apply(dna: CrisprInterface): Creature {
    /* Legacy */
    if ((dna as unknown as { nodes: { squash: string }[] }).nodes) {
      (dna as unknown as { neurons: { squash: string }[] }).neurons =
        (dna as unknown as { nodes: { squash: string }[] }).nodes;
    }

    if ((dna as unknown as { connections: { weight: number }[] }).connections) {
      (dna as unknown as { synapses: { weight: number }[] }).synapses =
        (dna as unknown as { connections: { weight: number }[] }).connections;
    }

    /* End Version 1 */

    if (dna.mode === "insert") {
      return this.insert(dna);
    } else {
      return this.append(dna);
    }
  }
}
