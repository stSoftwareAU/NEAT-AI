import { assert } from "@std/assert";
import { addTag, getTag, type TagsInterface } from "@stsoftware/tags";
import { Neuron } from "../architecture/Neuron.ts";
import { Creature } from "../Creature.ts";
import { CreatureUtil, Upgrade } from "../../mod.ts";

/**
 * Interface representing the structure of the CRISPR modification data.
 */
export interface CrisprInterface extends TagsInterface {
  /**
   * Unique identifier for the CRISPR modification.
   */
  id: string;

  /**
   * Mode of modification - can be either "insert" or "append".
   */
  mode: "insert" | "append";

  /**
   * Array of neurons to be modified or added.
   */
  neurons?: {
    /**
     * Unique identifier for the neuron.
     */
    uuid?: string;

    /**
     * Index position of the neuron in the network.
     */
    index?: number;

    /**
     * Type of the neuron - can be either "output" or "hidden".
     */
    type: "output" | "hidden";

    /**
     * Activation function of the neuron.
     */
    squash: string;

    /**
     * Bias value for the neuron.
     */
    bias: number;

    /**
     * Optional comment for the neuron.
     */
    comment?: string;
  }[];

  /**
   * Array of synapses to be modified or added.
   */
  synapses: {
    /**
     * Index of the source neuron.
     */
    from?: number;

    /**
     * Relative index of the source neuron.
     */
    fromRelative?: number;

    /**
     * UUID of the source neuron.
     */
    fromUUID?: string;

    /**
     * Index of the destination neuron.
     */
    to?: number;

    /**
     * Relative index of the destination neuron.
     */
    toRelative?: number;

    /**
     * UUID of the destination neuron.
     */
    toUUID?: string;

    /**
     * Weight of the synapse.
     */
    weight: number;

    /**
     * Type of the synapse - can be "positive", "negative", or "condition".
     */
    type?: "positive" | "negative" | "condition";

    /**
     * Optional comment for the synapse.
     */
    comment?: string;
  }[];
}

/**
 * CRISPR Class
 *
 * This class provides methods for targeted genetic modifications to the AI entities,
 * inspired by the CRISPR gene-editing technology.
 */
export class CRISPR {
  private creature: Creature;

  /**
   * Constructor for the CRISPR class.
   * @param creature - The creature instance to apply modifications on.
   */
  constructor(creature: Creature) {
    this.creature = Creature.fromJSON(creature.exportJSON());
  }

  /**
   * Static method to edit aliases in the CRISPR DNA.
   * @param dna - The CRISPR DNA to edit.
   * @param aliases - A record of aliases to replace in the DNA.
   * @returns The edited CRISPR DNA.
   */
  static editAliases(
    dna: CrisprInterface,
    aliases: Record<string, string>,
  ): CrisprInterface {
    const crispr: CrisprInterface = JSON.parse(JSON.stringify(dna));

    if (crispr.synapses) {
      for (const key in aliases) {
        const value = aliases[key];
        crispr.synapses.forEach((synapse) => {
          if (synapse.fromUUID === key) {
            synapse.fromUUID = value;
          }
        });
      }
    }

    return crispr;
  }

  /**
   * Append new neurons and synapses to the creature based on the provided DNA.
   * @param dna - The CRISPR DNA specifying the neurons and synapses to append.
   * @returns The modified creature.
   */
  private append(dna: CrisprInterface): Creature {
    const tmpCreature = Creature.fromJSON(this.creature.exportJSON());
    const UUIDs = new Map<string, number>();

    tmpCreature.neurons.forEach((node) => {
      assert(node.uuid !== undefined, "missing uuid");
      UUIDs.set(node.uuid, node.index);
    });

    let adjustIndx = 0;
    if (dna.neurons) {
      let firstDnaOutputIndex = -1;
      dna.neurons.forEach((neuron) => {
        if (neuron.type === "output") {
          if (firstDnaOutputIndex === -1 && neuron.index !== undefined) {
            firstDnaOutputIndex = neuron.index;
          }
        }
      });

      let firstNetworkOutputIndex = -1;
      tmpCreature.neurons.forEach((neuron, indx) => {
        if (neuron.type === "output") {
          if (firstNetworkOutputIndex === -1) {
            firstNetworkOutputIndex = indx;
          }
          (neuron as unknown as { type: string }).type = "hidden";
          if (neuron.uuid?.startsWith("output-")) {
            const uuid = crypto.randomUUID();
            dna.synapses.forEach((synapse) => {
              if (synapse.fromUUID === neuron.uuid) {
                synapse.fromUUID = uuid;
              }
            });

            neuron.uuid = uuid;
            UUIDs.set(uuid, indx);
          }
        }
      });

      adjustIndx = firstNetworkOutputIndex - firstDnaOutputIndex +
        dna.neurons.length;

      let outputIndx = 0;
      dna.neurons.forEach((dnaNeuron) => {
        let uuid: string;
        if (dnaNeuron.type === "output") {
          uuid = `output-${outputIndx}`;
          outputIndx++;
        } else {
          uuid = dnaNeuron.uuid
            ? UUIDs.has(dnaNeuron.uuid) ? crypto.randomUUID() : dnaNeuron.uuid
            : crypto.randomUUID();
        }
        const indx = dnaNeuron.index !== undefined
          ? dnaNeuron.index + adjustIndx
          : UUIDs.size - 1;

        const neuron = new Neuron(
          uuid,
          dnaNeuron.type,
          dnaNeuron.bias,
          tmpCreature,
          dnaNeuron.squash,
        );
        neuron.index = indx;
        UUIDs.set(uuid, indx);
        addTag(neuron, "CRISPR", dna.id);
        if (dnaNeuron.comment) {
          addTag(neuron, "comment", dnaNeuron.comment);
        }
        tmpCreature.neurons.push(neuron);
      });
    }
    tmpCreature.clearCache();
    dna.synapses.forEach((s) => {
      const from = s.fromUUID
        ? UUIDs.get(s.fromUUID)
        : s.from !== undefined
        ? s.from
        : s.fromRelative !== undefined
        ? s.fromRelative + adjustIndx
        : undefined;
      const to = s.toUUID
        ? UUIDs.get(s.toUUID)
        : s.to !== undefined
        ? s.to
        : s.toRelative !== undefined
        ? s.toRelative + adjustIndx
        : undefined;

      assert(
        from !== undefined && Number.isFinite(from) && from >= 0,
        `Invalid connection (from): ${from}`,
      );
      assert(
        to !== undefined && Number.isFinite(to) && to >= 0,
        `Invalid connection (to): ${to}`,
      );

      const currentSynapse = tmpCreature.getSynapse(from, to);
      if (!currentSynapse) {
        const synapse = tmpCreature.connect(from, to, s.weight, s.type);
        addTag(synapse, "CRISPR", dna.id);
        if (s.comment) {
          addTag(synapse, "comment", s.comment);
        }
      }
    });

    return tmpCreature;
  }

  /**
   * Insert new neurons and synapses into the creature based on the provided DNA.
   * @param dna - The CRISPR DNA specifying the neurons and synapses to insert.
   * @returns The modified creature.
   */
  private insert(dna: CrisprInterface): Creature {
    const exportJSON = this.creature.exportJSON();
    const tmpCreature = Creature.fromJSON(exportJSON);
    tmpCreature.synapses = [];

    const uuidMap = new Map<string, number>();

    if (dna.neurons) {
      dna.neurons.forEach((neuron) => {
        assert(neuron.type !== "output", "Cannot insert output neurons");
      });

      const neurons: Neuron[] = [];
      tmpCreature.neurons.forEach((neuron, indx) => {
        assert(neuron.uuid, "Missing uuid");
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
    }

    tmpCreature.clearCache();
    dna.synapses.forEach((c) => {
      assert(
        c.fromRelative === undefined && c.toRelative === undefined,
        "Cannot insert relative synapses",
      );

      assert(
        c.from === undefined,
        "Cannot insert static index (from) synapses",
      );
      assert(c.to === undefined, "Cannot insert static index (to) synapses");

      assert(
        c.fromUUID !== undefined && c.toUUID !== undefined,
        "Missing UUID for synapse",
      );
    });

    dna.synapses.forEach((s) => {
      assert(s.fromUUID !== undefined, "Missing fromUUID");
      const fromIndx = uuidMap.get(s.fromUUID);
      assert(s.toUUID !== undefined, "Missing toUUID");
      const toIndx = uuidMap.get(s.toUUID);

      assert(
        fromIndx !== undefined,
        "Invalid connection (from): " + JSON.stringify(s),
      );
      assert(
        toIndx !== undefined,
        "Invalid connection (to): " + JSON.stringify(s),
      );

      const currentSynapse = tmpCreature.getSynapse(fromIndx, toIndx);
      if (!currentSynapse) {
        const synapse = tmpCreature.connect(fromIndx, toIndx, s.weight, s.type);
        addTag(synapse, "CRISPR", dna.id);
        if (s.comment) {
          addTag(synapse, "comment", s.comment);
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

  /**
   * Apply the CRISPR modifications to the creature based on the specified DNA.
   * @param dna - The CRISPR DNA specifying the modifications.
   * @returns The modified creature or undefined if no modifications were applied.
   */
  cleaveDNA(dna: CrisprInterface): Creature {
    let alreadyProcessed = false;

    const uuid = CreatureUtil.makeUUID(this.creature);
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
    const modifiedUUID = CreatureUtil.makeUUID(modifiedCreature);
    if (uuid !== modifiedUUID) {
      addTag(modifiedCreature, "CRISPR-SOURCE", uuid);
      addTag(modifiedCreature, "CRISPR-DNA", dna.id); // DNA that was used to modify
      return modifiedCreature;
    }

    return modifiedCreature;
  }
}
