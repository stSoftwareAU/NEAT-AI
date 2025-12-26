import { removeTag } from "@stsoftware/tags/mod";
import { Creature, CreatureUtil, Mutation } from "../../mod.ts";
import { creatureValidate } from "../architecture/CreatureValidate.ts";
import { discover } from "../blackbox/Discover.ts";
import { memeticUpdate } from "../blackbox/MemeticUpdate.ts";
import type { NeatConfig } from "../config/NeatConfig.ts";
import type { RadioactiveInterface } from "../mutate/RadioactiveInterface.ts";
import { AddNeuron } from "../mutate/AddNeuron.ts";
import { SubNeuron } from "../mutate/SubNeuron.ts";
import { AddConnection } from "../mutate/AddConnection.ts";
import { SubConnection } from "../mutate/SubConnection.ts";
import { ModWeight } from "../mutate/ModWeight.ts";
import { ModBias } from "../mutate/ModBias.ts";
import { assert } from "@std/assert";
import { ModActivation as ModSquash } from "../mutate/ModSquash.ts";
import { AddSelfCon } from "../mutate/AddSelfCon.ts";
import { SubSelfCon } from "../mutate/SubSelfCon.ts";
import { AddBackCon } from "../mutate/AddBackCon.ts";
import { SubBackCon } from "../mutate/SubBackCon.ts";
import { SwapNeurons } from "../mutate/SwapNeurons.ts";

function upgradeSemanticVersionIfForwardOnlyConfirmed(creature: Creature) {
  // Once forward-only is confirmed, bump 2.x.x/3.x.x → 4.0.0.
  // Backwards compatibility: never downgrade (e.g. 4.1.2 stays 4.1.2).
  const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(creature.semanticVersion);
  if (!match) return;
  const major = Number.parseInt(match[1], 10);
  if (major === 2 || major === 3) {
    creature.semanticVersion = "4.0.0";
  }
}

export class Mutator {
  private config: NeatConfig;
  constructor(config: NeatConfig) {
    this.config = config;
  }

  /**
   * Extracts the major version number from a semantic version string.
   * @param version - Semantic version string (e.g. "4.0.0")
   * @returns The major version number, or 0 if invalid/undefined
   */
  private getMajorVersion(version: string | undefined): number {
    if (!version) return 0;
    const major = parseInt(version.split(".")[0], 10);
    return Number.isNaN(major) ? 0 : major;
  }

  /**
   * Mutates the given (or current) population
   */
  mutate(creatures: Creature[]): void {
    for (let i = creatures.length; i--;) {
      if (Math.random() <= this.config.mutationRate) {
        const creature = creatures[i];
        let original: Creature | undefined;
        if (creature.score !== undefined || creature.memetic) {
          original = Creature.fromJSON(creature.exportJSON());
          original.score = creature.score;
        }
        let changed = false;
        for (let j = this.config.mutationAmount; j--;) {
          const mutationMethod = this.selectMutationMethod(creature);

          const flag = this.mutateCreature(
            creature,
            mutationMethod,
            Math.random() < this.config.focusRate
              ? this.config.focusList
              : undefined,
          );
          if (flag) {
            changed = true;
          }
        }

        if (this.config.debug) {
          creatureValidate(creature);
        }

        if (changed) {
          removeTag(creature, "approach");
          removeTag(creature, "approach-logged");
          removeTag(creature, "trainID");
          removeTag(creature, "trained");

          creature.clearState();
          delete creature.memetic;
          delete creature.uuid;
          creature.state.preparedNeurons = false;
          if (original) {
            const memetic = memeticUpdate(original, creature);
            if (memetic) {
              creature.memetic = memetic;
            } else {
              discover(original, creature);
            }
          }
        }
      }
    }
  }

  /**
   * Calculate the theoretical maximum number of synapses for a given number of neurons,
   * considering that observation neurons do not connect to each other.
   * @param observations - Number of observation (input) neurons.
   * @param hidden - Number of hidden neurons.
   * @param outputs - Number of output neurons.
   * @returns The maximum number of synapses.
   */
  calculateMaxSynapses(
    observations: number,
    hidden: number,
    outputs: number,
  ): number {
    // Observations to hidden connections
    const obsToHidden = observations * hidden;

    // Observations to outputs connections
    const obsToOutputs = observations * outputs;

    // Hidden to hidden connections (no cycles)
    const hiddenToHidden = (hidden * (hidden - 1)) / 2;

    // Hidden to outputs connections
    const hiddenToOutputs = hidden * outputs;

    // Total possible synapses
    return obsToHidden + obsToOutputs + hiddenToHidden + hiddenToOutputs;
  }

  /**
   * Selects a random mutation method for a genome according to the parameters
   */
  public selectMutationMethod(creature: Creature) {
    const mutationMethods = this.config
      .mutation;

    const feedbackLoop = this.config.feedbackLoop;
    const majorVersion = this.getMajorVersion(creature.semanticVersion);
    const forwardOnly = majorVersion >= 4 || creature.forwardOnly === true;

    // Avoid infinite loops: pre-filter for methods that can actually run under
    // the current constraints.
    const candidates = mutationMethods.filter((method) => {
      switch (method.name) {
        case Mutation.ADD_NODE.name:
          return creature.neurons.length < this.config.maximumNumberOfNodes;
        case Mutation.ADD_CONN.name:
          return !(creature.synapses.length >= this.config.maxConns ||
            creature.synapses.length >=
              this.calculateMaxSynapses(
                creature.input,
                creature.neurons.length - creature.input - creature.output,
                creature.output,
              ));
        case Mutation.SUB_NODE.name:
          return creature.neurons.length > creature.input + creature.output;
        case Mutation.SWAP_NODES.name:
          return creature.neurons.length > creature.input + creature.output + 1;
        case Mutation.ADD_BACK_CONN.name:
        case Mutation.SUB_BACK_CONN.name:
        case Mutation.ADD_SELF_CONN.name:
        case Mutation.SUB_SELF_CONN.name:
          // Self/back connections are only valid in feedback/memory mode and never
          // for semanticVersion 4.x forward-only creatures.
          return feedbackLoop !== false && forwardOnly === false;
        default:
          return true;
      }
    });

    if (candidates.length === 0) {
      throw new Error(
        `No valid mutation methods available for creature (semanticVersion=${creature.semanticVersion}, forwardOnly=${forwardOnly}) ` +
          `with config.feedbackLoop=${this.config.feedbackLoop}.`,
      );
    }

    for (let attempts = 0; attempts < 10_000; attempts++) {
      const mutationMethod = candidates[
        Math.floor(Math.random() * candidates.length)
      ];

      if (Math.random() < 0.25) {
        if (
          mutationMethod.name !== Mutation.MOD_BIAS.name &&
          mutationMethod.name !== Mutation.MOD_WEIGHT.name
        ) {
          continue;
        }
      }
      return mutationMethod;
    }

    // Extremely unlikely fallback: candidates exist but we keep skipping due to the
    // 25% "bias/weight only" gate.
    return candidates[0];
  }

  /**
   * Mutate the creature using a specific method.
   *
   * @param {Object} method - The mutation method.
   * @param {string} method.name - The name of the mutation method.
   * @param {number[]} [focusList] - The list of focus indices.
   */
  public mutateCreature(
    creature: Creature,
    method: { name: string },
    focusList?: number[],
  ): boolean {
    assert(method.name, "Mutate name is required");
    const startUUID = CreatureUtil.makeUUID(creature);
    let mutator: RadioactiveInterface | undefined;

    // If the caller enables feedback loops, forward-only constraints no longer apply.
    // Clear the flag so subsequent mutation/breeding can introduce memory connections.
    // However, semanticVersion 4.x is a hard forward-only invariant and must never
    // be cleared/relaxed.
    const majorVersion = this.getMajorVersion(creature.semanticVersion);
    if (
      this.config.feedbackLoop === true &&
      creature.forwardOnly === true &&
      majorVersion < 4
    ) {
      console.warn(
        `[Mutator] feedbackLoop=true requested for forwardOnly creature (${startUUID}); clearing creature.forwardOnly flag`,
      );
      creature.forwardOnly = undefined;
    }

    switch (method.name) {
      case Mutation.ADD_NODE.name:
        mutator = new AddNeuron(creature);
        break;
      case Mutation.SUB_NODE.name:
        mutator = new SubNeuron(creature);
        break;
      case Mutation.ADD_CONN.name:
        mutator = new AddConnection(creature);
        break;
      case Mutation.SUB_CONN.name:
        mutator = new SubConnection(creature);
        break;
      case Mutation.MOD_WEIGHT.name:
        mutator = new ModWeight(creature);
        break;
      case Mutation.MOD_BIAS.name:
        mutator = new ModBias(creature);
        break;
      case Mutation.MOD_SQUASH.name:
        mutator = new ModSquash(creature);
        break;
      case Mutation.ADD_SELF_CONN.name:
        mutator = new AddSelfCon(creature);
        break;
      case Mutation.SUB_SELF_CONN.name:
        mutator = new SubSelfCon(creature);
        break;
      case Mutation.ADD_BACK_CONN.name:
        mutator = new AddBackCon(creature);
        break;
      case Mutation.SUB_BACK_CONN.name:
        mutator = new SubBackCon(creature);
        break;
      case Mutation.SWAP_NODES.name:
        mutator = new SwapNeurons(creature);
        break;
      default: {
        throw new Error("unknown: " + method);
      }
    }

    let changed = false;
    changed = mutator.mutate(focusList);

    if (!changed && (!focusList || focusList.length === 0)) {
      console.info(
        `${method.name} didn't mutate the creature. ${creature.input} observations, ${
          creature.neurons.length - creature.input - creature.output
        } neurons, ${creature.output} outputs, ${creature.synapses.length} synapses`,
      );
    }

    if (changed) {
      delete creature.uuid;
      creature.state.preparedNeurons = false;
      // Always run the general fix first.
      creature.fix();

      // Forward-only mode: if the creature is marked forward-only or the run is not using
      // feedback loops, ensure mutations can't accidentally keep recurrent connections.
      if (this.config.feedbackLoop !== true || creature.forwardOnly === true) {
        try {
          creature.validate({ forwardOnly: true });

          // In forward-only runs, most creatures should already be valid. Once we
          // confirm that (via validation), mark + upgrade without requiring a fix().
          if (this.config.feedbackLoop !== true) {
            creature.forwardOnly = true;
          }
          if (creature.forwardOnly === true) {
            upgradeSemanticVersionIfForwardOnlyConfirmed(creature);
          }
        } catch (e) {
          const error = e as Error;
          if (
            error.name === "SELF_CONNECTION" ||
            error.name === "RECURSIVE_SYNAPSE"
          ) {
            const match = /^(\d+)\.(\d+)\.(\d+)(.*)$/.exec(
              creature.semanticVersion,
            );
            const major = match ? Number.parseInt(match[1], 10) : 0;

            const violations = creature.synapses
              .map((s, i) => ({ s, i }))
              .filter(({ s }) => s.from === s.to || s.from > s.to)
              .slice(0, 10)
              .map(({ s, i }) =>
                `${i}) ${s.from} (${
                  creature.neurons[s.from]?.ID?.() ?? "?"
                }) -> ${s.to} (${creature.neurons[s.to]?.ID?.() ?? "?"})`
              );
            console.error(
              `[Mutator] Forward-only violation after '${method.name}'. This indicates a bug: ` +
                `creature is marked forwardOnly=${
                  creature.forwardOnly === true
                } and/or feedbackLoop=${this.config.feedbackLoop}. ` +
                `Error=${error.name}: ${error.message}. ` +
                `Violations(sample up to 10): ${violations.join(" | ")}`,
            );

            // Forward-only 4.x is a hard guarantee. We must crash fast (even on
            // unattended machines) so we can locate the logic that introduced a
            // recurrent connection into a supposedly forward-only creature.
            if (major >= 4) {
              throw new Error(
                `[Mutator] CRITICAL: forward-only 4.x creature became invalid after '${method.name}': ` +
                  `${error.name} - ${error.message}. ` +
                  `This indicates a corruption bug (recurrent connections must never be introduced). ` +
                  `Violations(sample up to 10): ${violations.join(" | ")}`,
              );
            }

            creature.fix({ forwardOnly: true });

            // Re-validate after fix() so we don't carry a corrupted creature forward.
            // Once validated in a forward-only run, mark + upgrade to 4.x.
            try {
              creature.validate({ forwardOnly: true });
            } catch (_stillInvalid) {
              // Defensive fallback: if fix() did not fully remove recurrent links,
              // explicitly filter self/back connections and re-validate.
              //
              // Australian English: this is intentionally redundant because this path
              // can run unattended and we prefer deterministic recovery for pre-4.x
              // creatures rather than flaky test failures.
              creature.synapses = creature.synapses.filter((s) =>
                s.from !== s.to && s.from < s.to
              );
              creature.synapses.sort((a, b) =>
                a.from === b.from ? a.to - b.to : a.from - b.from
              );
              creature.clearCache();
              creature.validate({ forwardOnly: true });
            }
            if (this.config.feedbackLoop !== true) {
              creature.forwardOnly = true;
            }
            if (creature.forwardOnly === true) {
              upgradeSemanticVersionIfForwardOnlyConfirmed(creature);
            }
          } else {
            // Keep behaviour consistent with Offspring.breed(): only forward-only
            // violations are repaired here; all other validation failures must surface.
            throw e;
          }
        }
      }
    }
    if (creature.DEBUG) {
      creatureValidate(creature);
    }

    const endUUID = CreatureUtil.makeUUID(creature);
    if (startUUID === endUUID) {
      console.warn(
        `UUID didn't change after ${method.name} mutation, changed: ${changed}`,
      );
      return false;
    } else {
      return true;
    }
  }
}
