import { addTag, getTag, type TagsInterface } from "@stsoftware/tags/mod";
import { CreatureUtil, Upgrade } from "../../mod.ts";
import { Neuron } from "../architecture/Neuron.ts";
import { nextNeuronId, outputNeuronId } from "../architecture/NeuronId.ts";
import type { Creature } from "../Creature.ts";
import { CrisprError } from "../errors/CrisprError.ts";
import type { ValidationError } from "../errors/ValidationError.ts";
import {
  getMajorVersion,
  upgradeSemanticVersionIfForwardOnlyConfirmed,
} from "../upgrade/Upgrade.ts";
import { getLogger } from "../utils/Logger.ts";
import { validateDNA } from "./validateDNA.ts";

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
    id?: number;

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
    fromId?: number;

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
    toId?: number;

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
    // shallowClone preserves runtime neuron ids; public exportJSON omits ids and
    // would remap ids on re-import, breaking CRISPR DNA fromId/toId resolution.
    this.creature = creature.shallowClone();
  }

  /**
   * Static method to edit aliases in the CRISPR DNA.
   * @param dna - The CRISPR DNA to edit.
   * @param aliases - A record of aliases to replace in the DNA.
   * @returns The edited CRISPR DNA.
   */
  static editAliases(
    dna: CrisprInterface,
    aliases: Record<number, number>,
  ): CrisprInterface {
    const crispr: CrisprInterface = JSON.parse(JSON.stringify(dna));

    for (const key in aliases) {
      const numericKey = Number(key);
      const value = aliases[numericKey];

      if (crispr.neurons) {
        crispr.neurons.forEach((neuron) => {
          if (neuron.id === numericKey) {
            neuron.id = value;
          }
        });
      }

      if (crispr.synapses) {
        crispr.synapses.forEach((synapse) => {
          if (synapse.fromId === numericKey) {
            synapse.fromId = value;
          }
          if (synapse.toId === numericKey) {
            synapse.toId = value;
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
    const tmpCreature = this.creature.shallowClone();
    const UUIDs = new Map<number, number>();

    tmpCreature.neurons.forEach((node) => {
      UUIDs.set(node.id, node.index);
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
          neuron.type = "hidden";
          if (neuron.uuid === undefined) {
            neuron.uuid = crypto.randomUUID();
          }
          if (neuron.id !== undefined && neuron.id < 0) {
            const uuid = nextNeuronId();
            dna.synapses.forEach((synapse) => {
              if (synapse.fromId === neuron.id) {
                synapse.fromId = uuid;
              }
            });

            neuron.id = uuid;
            UUIDs.set(uuid, indx);
          }
        }
      });

      adjustIndx = firstNetworkOutputIndex - firstDnaOutputIndex +
        dna.neurons.length;

      let outputIndx = 0;
      dna.neurons.forEach((dnaNeuron) => {
        let uuid: number;
        if (dnaNeuron.type === "output") {
          uuid = outputNeuronId(outputIndx);
          outputIndx++;
        } else {
          uuid = dnaNeuron.id !== undefined
            ? UUIDs.has(dnaNeuron.id) ? nextNeuronId() : dnaNeuron.id
            : nextNeuronId();
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
      const from = s.fromId !== undefined
        ? UUIDs.get(s.fromId)
        : s.from !== undefined
        ? s.from
        : s.fromRelative !== undefined
        ? s.fromRelative + adjustIndx
        : undefined;
      const to = s.toId !== undefined
        ? UUIDs.get(s.toId)
        : s.to !== undefined
        ? s.to
        : s.toRelative !== undefined
        ? s.toRelative + adjustIndx
        : undefined;

      if (from === undefined || !Number.isFinite(from) || from < 0) {
        throw new CrisprError(
          `Invalid connection (from): ${from}`,
          "INVALID_CONNECTION",
        );
      }
      if (to === undefined || !Number.isFinite(to) || to < 0) {
        throw new CrisprError(
          `Invalid connection (to): ${to}`,
          "INVALID_CONNECTION",
        );
      }

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
    const tmpCreature = this.creature.shallowClone();
    tmpCreature.synapses = [];

    const idMap = new Map<number, number>();

    if (dna.neurons) {
      dna.neurons.forEach((neuron) => {
        if (neuron.type === "output") {
          throw new CrisprError("Cannot insert output neurons", "INVALID_DNA");
        }
      });

      const neurons: Neuron[] = [];
      tmpCreature.neurons.forEach((neuron, indx) => {
        if (neuron.id === undefined) {
          throw new CrisprError("Missing id", "MISSING_UUID");
        }
        if (neuron.type !== "output") {
          idMap.set(neuron.id, indx);
          neurons.push(neuron);
        }
      });

      dna.neurons.forEach((dnaNeuron) => {
        if (dnaNeuron.id === undefined || !idMap.has(dnaNeuron.id)) {
          const uuid = dnaNeuron.id !== undefined
            ? dnaNeuron.id
            : nextNeuronId();
          const indx = idMap.size;

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

          idMap.set(uuid, indx);
        }
      });
      for (
        let indx = tmpCreature.neurons.length - tmpCreature.output;
        indx < tmpCreature.neurons.length;
        indx++
      ) {
        const neuron = tmpCreature.neurons[indx];
        const updatedIndx = idMap.size;
        neuron.index = updatedIndx;
        neurons.push(neuron);
        idMap.set(neuron.id, updatedIndx);
      }

      tmpCreature.neurons = neurons;
    } else {
      tmpCreature.neurons.forEach((neuron, indx) => {
        idMap.set(neuron.id, indx);
      });
    }

    tmpCreature.clearCache();
    dna.synapses.forEach((c) => {
      if (c.fromRelative !== undefined || c.toRelative !== undefined) {
        throw new CrisprError("Cannot insert relative synapses", "INVALID_DNA");
      }

      if (c.from !== undefined) {
        throw new CrisprError(
          "Cannot insert static index (from) synapses",
          "INVALID_DNA",
        );
      }
      if (c.to !== undefined) {
        throw new CrisprError(
          "Cannot insert static index (to) synapses",
          "INVALID_DNA",
        );
      }

      if (c.fromId === undefined || c.toId === undefined) {
        throw new CrisprError("Missing UUID for synapse", "INVALID_DNA");
      }
    });

    dna.synapses.forEach((s) => {
      if (s.fromId === undefined) {
        throw new CrisprError("Missing fromId", "MISSING_UUID");
      }
      const fromIndx = idMap.get(s.fromId);
      if (fromIndx === undefined) {
        throw new CrisprError(
          "Invalid connection (from): " + JSON.stringify(s),
          "MISSING_UUID",
        );
      }

      if (s.toId === undefined) {
        throw new CrisprError("Missing toId", "MISSING_UUID");
      }
      const toIndx = idMap.get(s.toId);

      if (toIndx === undefined) {
        throw new CrisprError(
          "Invalid connection (to): " + JSON.stringify(s),
          "MISSING_UUID",
        );
      }

      const currentSynapse = tmpCreature.getSynapse(fromIndx, toIndx);
      if (!currentSynapse) {
        const synapse = tmpCreature.connect(fromIndx, toIndx, s.weight, s.type);
        addTag(synapse, "CRISPR", dna.id);
        if (s.comment) {
          addTag(synapse, "comment", s.comment);
        }
      }
    });

    this.creature.synapses.forEach((synapse) => {
      const fromId = this.creature.neurons[synapse.from].id;
      const toId = this.creature.neurons[synapse.to].id;
      const fromIndx = idMap.get(fromId);
      const toIndx = idMap.get(toId);

      if (fromIndx !== undefined && toIndx !== undefined) {
        if (tmpCreature.getSynapse(fromIndx, toIndx) === null) {
          tmpCreature.connect(fromIndx, toIndx, synapse.weight, synapse.type);
        }
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
    validateDNA(dna);

    let alreadyProcessed = false;

    const uuid = CreatureUtil.makeUUID(this.creature);
    const enforceForwardOnly = this.creature.forwardOnly === true ||
      getMajorVersion(this.creature.semanticVersion) >= 4;
    this.creature.neurons.forEach((neuron) => {
      if (neuron.id === undefined) {
        throw new CrisprError("missing id", "MISSING_UUID");
      }

      const id = getTag(neuron, "CRISPR");

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
    try {
      if (dnaClean.mode === "insert") {
        modifiedCreature = this.insert(dnaClean);
      } else {
        modifiedCreature = this.append(dnaClean);
      }
    } catch (e) {
      if (e instanceof CrisprError) {
        getLogger().warn(`CRISPR ${dna.id}: ${e.code} — ${e.message}`);
        return this.creature;
      }
      throw e;
    }

    delete modifiedCreature.uuid;
    delete modifiedCreature.memetic;

    try {
      if (enforceForwardOnly) {
        // Forward-only is a hard invariant for semanticVersion 4.x (and for any
        // creature explicitly marked as forward-only). CRISPR must never be able
        // to introduce recurrent connections into such creatures.
        try {
          modifiedCreature.validate({ forwardOnly: true });
        } catch (e) {
          const error = e as ValidationError;
          if (
            error.reason === "SELF_CONNECTION" ||
            error.reason === "RECURSIVE_SYNAPSE"
          ) {
            modifiedCreature.fix({ forwardOnly: true });
            modifiedCreature.validate({ forwardOnly: true });
          } else {
            throw e;
          }
        }
        modifiedCreature.forwardOnly = true;
        upgradeSemanticVersionIfForwardOnlyConfirmed(modifiedCreature);
      } else {
        modifiedCreature.validate();
      }
    } catch (e) {
      if (e instanceof CrisprError) {
        // Expected operational errors — log and return the original creature.
        getLogger().warn(
          `CRISPR ${dna.id}: ${e.code} — ${e.message}`,
        );
        return this.creature;
      }

      // Unexpected errors — log the invalid creature for debugging, then
      // return the original creature. The JSON is logged rather than written
      // to the working directory so core logic has no file-system side effects.
      const creatureJSON = JSON.stringify(
        modifiedCreature.exportJSON(),
        null,
        1,
      );
      getLogger().warn(
        `CRISPR ${dna.id}: unexpected error during validation.\n` +
          `Creature JSON:\n${creatureJSON}`,
        e,
      );
      return this.creature;
    }

    const modifiedUUID = CreatureUtil.makeUUID(modifiedCreature);
    if (uuid !== modifiedUUID) {
      addTag(modifiedCreature, "CRISPR-SOURCE", uuid);
      addTag(modifiedCreature, "CRISPR-DNA", dna.id); // DNA that was used to modify
    }

    return modifiedCreature;
  }
}
