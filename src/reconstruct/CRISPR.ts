import { assert } from "https://deno.land/std@0.223.0/assert/mod.ts";
import {
  addTag,
  getTag,
  TagsInterface,
} from "https://deno.land/x/tags@v1.0.2/mod.ts";
import { Neuron } from "../architecture/Neuron.ts";
import { Creature } from "../Creature.ts";
import { CreatureUtil, Upgrade } from "../../mod.ts";

export interface CrisprInterface extends TagsInterface {
  id: string;
  mode: "insert" | "append";

  neurons?: {
    uuid?: string;
    index?: number;
    type: "output" | "hidden";
    squash: string;
    bias: number;
    comment?: string;
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
    comment?: string;
  }[];
}

export class CRISPR {
  private creature;

  constructor(
    creature: Creature,
  ) {
    this.creature = Creature.fromJSON(
      creature.exportJSON(),
    );
  }

  static editAliases(
    dna: CrisprInterface,
    aliases: Record<string, string>,
  ): CrisprInterface {
    const crispr: CrisprInterface = JSON.parse(
      JSON.stringify(dna),
    );

    if (crispr.synapses) {
      for (const key in aliases) {
        const value = aliases[key];
        crispr.synapses.forEach((synapse) => {
          if (synapse.fromUUID == key) {
            synapse.fromUUID = value;
            // console.info("From", key, "to", value);
          }
        });
      }
    }

    return crispr;
  }

  private append(dna: CrisprInterface) {
    const tmpCreature = Creature.fromJSON(
      this.creature.exportJSON(),
    );

    const UUIDs = new Map<string, number>();
    tmpCreature.neurons.forEach((node) => {
      assert(node.uuid !== undefined, "missing uuid");

      UUIDs.set(node.uuid, node.index);
    });

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
        let indx;
        if (dnaNeuron.index !== undefined) {
          indx = dnaNeuron.index + adjustIndx;
        } else {
          indx = tmpCreature.neurons.length;
        }

        const neuron = new Neuron(
          uuid,
          dnaNeuron.type,
          dnaNeuron.bias,
          tmpCreature,
          dnaNeuron.squash,
        );
        neuron.index = indx;

        addTag(neuron, "CRISPR", dna.id);
        if (dnaNeuron.comment) {
          addTag(neuron, "comment", dnaNeuron.comment);
        }
        tmpCreature.neurons.push(neuron);
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
          if (c.comment) {
            addTag(synapse, "comment", c.comment);
          }
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

    if (dna.neurons) {
      dna.neurons.forEach((neuron) => {
        if (neuron.type == "output") {
          throw new Error("Cannot insert output neurons");
        }
      });

      dna.synapses.forEach((c) => {
        if (c.fromRelative) {
          throw new Error("Cannot insert relative synapses");
        }
        if (c.toRelative) {
          throw new Error("Cannot insert relative synapses");
        }

        if (c.from !== undefined) {
          throw new Error("Cannot insert static from index synapses");
        }
        if (c.to !== undefined) {
          throw new Error("Cannot insert static to index synapses");
        }

        if (c.fromUUID === undefined) {
          throw new Error("Missing fromUUID");
        }
        if (c.toUUID === undefined) {
          throw new Error("Missing toUUID");
        }
      });

      const neurons: Neuron[] = [];
      tmpCreature.neurons.forEach((neuron, indx) => {
        assert(neuron.uuid !== undefined, "missing uuid");
        if (neuron.type !== "output") {
          uuidMap.set(neuron.uuid, indx);
          neurons.push(neuron);
        }
      });

      dna.neurons.forEach((dnaNeuron) => {
        const uuid = dnaNeuron.uuid
          ? uuidMap.has(dnaNeuron.uuid) ? crypto.randomUUID() : dnaNeuron.uuid
          : crypto.randomUUID();
        const indx = uuidMap.size;

        const neuron = new Neuron(
          uuid,
          dnaNeuron.type,
          dnaNeuron.bias,
          tmpCreature,
          dnaNeuron.squash,
        );
        neuron.index = indx;

        addTag(neuron, "CRISPR", dna.id);
        if (dnaNeuron.comment) {
          addTag(neuron, "comment", dnaNeuron.comment);
        }
        neurons.push(neuron);

        uuidMap.set(uuid, indx);
      });
      for (
        let indx = tmpCreature.neurons.length - tmpCreature.output;
        indx < tmpCreature.neurons.length;
        indx++
      ) {
        const neuron = tmpCreature.neurons[indx];
        const updatedIndx = uuidMap.size;
        neuron.index = updatedIndx;
        neurons.push(neuron);
        uuidMap.set(neuron.uuid, updatedIndx);
      }

      tmpCreature.neurons = neurons;
      tmpCreature.clearCache();
      dna.synapses.forEach((c) => {
        let fromIndx: number | undefined = undefined;
        const tmpIndx = uuidMap.get(c.fromUUID ?? "unknown");
        if (tmpIndx !== undefined) {
          fromIndx = tmpIndx;
        }

        assert(
          fromIndx !== undefined,
          "Invalid connection (from): " + JSON.stringify(c),
        );

        let toIndx: number | undefined = undefined;
        const tmpToIndx = uuidMap.get(c.toUUID ?? "unknown");
        if (tmpToIndx !== undefined) {
          toIndx = tmpToIndx;
        }

        assert(
          toIndx !== undefined,
          "Invalid connection (to): " + JSON.stringify(c),
        );

        const synapse = tmpCreature.connect(fromIndx, toIndx, c.weight, c.type);
        addTag(synapse, "CRISPR", dna.id);
        if (c.comment) {
          addTag(synapse, "comment", c.comment);
        }
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

  async cleaveDNA(dna: CrisprInterface): Promise<Creature | undefined> {
    let alreadyProcessed = false;

    const uuid = await CreatureUtil.makeUUID(this.creature);
    this.creature.neurons.forEach((node) => {
      assert(node.uuid !== undefined, "missing uuid");

      const id = getTag(node, "CRISPR");

      if (id === dna.id) {
        alreadyProcessed = true;
      }
    });

    if (!alreadyProcessed) {
      this.creature.synapses.forEach((synapse) => {
        const id = getTag(synapse, "CRISPR");

        if (id === dna.id) {
          alreadyProcessed = true;
        }
      });
    }

    if (alreadyProcessed) return this.creature;

    const dnaClean = Upgrade.CRISPR(dna);
    let modifiedCreature: Creature;
    if (dnaClean.mode === "insert") {
      modifiedCreature = this.insert(dnaClean);
    } else {
      modifiedCreature = this.append(dnaClean);
    }

    delete modifiedCreature.uuid;
    modifiedCreature.validate();
    const modifiedUUID = await CreatureUtil.makeUUID(modifiedCreature);
    if (uuid !== modifiedUUID) {
      return modifiedCreature;
    } else {
      return undefined;
    }
  }
}
