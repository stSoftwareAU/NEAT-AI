import { assert } from "@std/assert";
import { Creature } from "@creature";
import { SubConnection } from "@mutate/SubConnection.ts";
import { creatureValidate } from "@architecture/CreatureValidate.ts";
import {
  createSeededRng,
  getRandomNumberGenerator,
  setRandomNumberGenerator,
} from "@utils/RandomNumberGenerator.ts";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";

((globalThis as unknown) as { DEBUG: boolean }).DEBUG = true;

/**
 * Regression test for issue #3383.
 *
 * When `SubConnection` disconnects `from → to` and `to` loses its last inward
 * connection while keeping an outward one, `to` is demoted to a `constant` and
 * moved into the constant prefix. That move reindexes the neuron array, so the
 * captured `fromIndx` goes stale. The follow-up "did `from` lose its last
 * outward connection?" cleanup then inspected the wrong neuron and left the
 * genuine source neuron orphaned — a `constant`/`hidden` neuron with no outward
 * connections (`NO_OUTWARD_CONNECTIONS`). That invalid creature only failed
 * loudly once serialised by the evolution worker and deserialised in
 * `processCompletedResults` — the intermittent XOR-evolve coverage failure.
 *
 * The creature below is shaped so that removing `hidden-from → hidden-to`
 * triggers exactly this path: `hidden-to` (last in the array) loses its only
 * inward edge but keeps `hidden-to → output`, so it is demoted to a constant
 * and moved down into the constant prefix. That move shifts `hidden-from` up by
 * one, making the captured `fromIndx` point at the moved neuron; the stale
 * index then hid `hidden-from`'s loss of its only outward edge, leaving it
 * orphaned.
 */
Deno.test(
  "SubConnection: stale from-index after constant demotion never orphans the source neuron (#3383)",
  () => {
    const buildCreature = (): Creature => {
      const json: CreatureExport = {
        input: 2,
        output: 1,
        // Loaded order (constants first, then hidden): input-0(0), input-1(1),
        // constant-bias(2), hidden-from(3), hidden-mid(4), hidden-to(5),
        // output-0(6). hidden-to sits well above the constant prefix so its
        // demotion forces a real reindexing move.
        neurons: [
          { type: "constant", uuid: "constant-bias", bias: 0.3 },
          {
            type: "hidden",
            uuid: "hidden-from",
            squash: "IDENTITY",
            bias: 0.1,
          },
          { type: "hidden", uuid: "hidden-mid", squash: "IDENTITY", bias: 0.2 },
          { type: "hidden", uuid: "hidden-to", squash: "IDENTITY", bias: 0.3 },
          { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
        ],
        synapses: [
          // Keep constant-bias valid with its own outward edge.
          { fromUUID: "constant-bias", toUUID: "output-0", weight: 0.25 },
          // hidden-from's ONLY outward edge — removing it orphans hidden-from.
          { fromUUID: "hidden-from", toUUID: "hidden-to", weight: 0.4 },
          { fromUUID: "input-0", toUUID: "hidden-from", weight: 0.3 },
          // hidden-to's ONLY inward edge is hidden-from→hidden-to; it keeps an
          // outward edge to the output, so it is demoted (not removed).
          { fromUUID: "hidden-to", toUUID: "output-0", weight: 0.9 },
          // Keep hidden-mid and the output structurally valid.
          { fromUUID: "input-1", toUUID: "hidden-mid", weight: 0.15 },
          { fromUUID: "hidden-mid", toUUID: "output-0", weight: 0.5 },
        ],
      };
      return Creature.fromJSON(json);
    };

    const previousRng = getRandomNumberGenerator();
    try {
      // Focus the mutation on hidden-from (index 3) and hidden-to (index 5) so
      // the candidate set is small; loop many seeds so the branch that removes
      // `hidden-from → hidden-to` is exercised deterministically.
      const focusList = [3, 5];
      let removedTargetSynapse = 0;

      for (let seed = 0; seed < 200; seed++) {
        const creature = buildCreature();
        creatureValidate(creature);
        const before = creature.synapses.length;

        setRandomNumberGenerator(createSeededRng(seed));
        const changed = new SubConnection(creature).mutate(focusList);

        // Must always stay valid — no orphaned constant/hidden source neuron.
        creatureValidate(creature);

        // A JSON round-trip mirrors the worker serialise → load path that first
        // surfaced the bug; it must also validate.
        Creature.fromJSON(creature.exportJSON()).validate();

        if (changed && creature.synapses.length < before) {
          removedTargetSynapse++;
        }
      }

      assert(
        removedTargetSynapse > 0,
        "Expected SubConnection to remove a connection in at least one seed",
      );
    } finally {
      setRandomNumberGenerator(previousRng);
    }
  },
);
