/**
 * CompactModuleGraftBakeOff.ts — Issue #2493 evidence bench.
 *
 * Produces a synthetic Europa-style dense donor and a sparser production-
 * style recipient, then runs `runBakeOff` against {NoOp, CompactModuleGraft}
 * so the PR summary can record the structural change (Hidden UUIDs Shared
 * jumping from 0 to N) and the score lift on the probe dataset.
 *
 * The generic `bench/DnaSharingBakeOff.ts` loads small XOR fixtures by
 * default; this bench generates fixtures sized to exercise the dense-module
 * detection threshold (>=6 hidden neurons, density >> SubgraphTransplant).
 */
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import type { DataRecordInterface } from "@architecture/DataSet.ts";
import {
  CompactModuleGraftStrategy,
  formatBakeOffMarkdown,
  NoOpStrategy,
  runBakeOff,
} from "@transfer/mod.ts";

/** Build a creature from raw uuids and synapse triples. */
function buildCreature(
  inputCount: number,
  hiddenUUIDs: string[],
  outputCount: number,
  connections: Array<{ from: string; to: string; weight: number }>,
): Creature {
  const neurons: CreatureExport["neurons"] = hiddenUUIDs.map((uuid) => ({
    type: "hidden" as const,
    uuid,
    squash: "LOGISTIC",
    bias: 0.1,
  }));
  for (let i = 0; i < outputCount; i++) {
    neurons.push({
      type: "output",
      uuid: `output-${i}`,
      squash: "IDENTITY",
      bias: 0,
    });
  }
  const synapses = connections.map((c) => ({
    fromUUID: c.from,
    toUUID: c.to,
    weight: c.weight,
  }));
  return Creature.fromJSON({
    input: inputCount,
    output: outputCount,
    neurons,
    synapses,
  });
}

/** Europa-style dense donor: 8 hidden neurons in an all-pairs forward clique. */
function denseDonor(): Creature {
  const ids = ["d0", "d1", "d2", "d3", "d4", "d5", "d6", "d7"];
  const internal: Array<{ from: string; to: string; weight: number }> = [];
  for (let i = 0; i < ids.length; i++) {
    for (let j = i + 1; j < ids.length; j++) {
      internal.push({ from: ids[i], to: ids[j], weight: 0.3 });
    }
  }
  return buildCreature(
    3,
    ids,
    1,
    [
      { from: "input-0", to: "d0", weight: 0.5 },
      { from: "input-1", to: "d1", weight: -0.4 },
      { from: "input-2", to: "d2", weight: 0.3 },
      ...internal,
      { from: "d7", to: "output-0", weight: 0.6 },
    ],
  );
}

/** Production-style recipient: small sparse network. */
function sparseRecipient(): Creature {
  return buildCreature(
    3,
    ["mA", "mB"],
    1,
    [
      { from: "input-0", to: "mA", weight: 0.3 },
      { from: "input-1", to: "mB", weight: 0.4 },
      { from: "input-2", to: "mB", weight: 0.5 },
      { from: "mA", to: "output-0", weight: 0.6 },
      { from: "mB", to: "output-0", weight: 0.7 },
    ],
  );
}

function probe(): DataRecordInterface[] {
  return [
    {
      input: new Float32Array([0.1, 0.2, 0.3]),
      output: new Float32Array([0.5]),
    },
    {
      input: new Float32Array([0.5, 0.6, 0.7]),
      output: new Float32Array([0.5]),
    },
    {
      input: new Float32Array([0.9, 0.8, 0.7]),
      output: new Float32Array([0.5]),
    },
    {
      input: new Float32Array([0.2, 0.4, 0.6]),
      output: new Float32Array([0.5]),
    },
  ];
}

if (import.meta.main) {
  const recipient = sparseRecipient();
  const donor = denseDonor();
  const ds = probe();

  const rows = await runBakeOff({
    recipient: recipient.exportJSON(),
    donor: donor.exportJSON(),
    probe: ds,
    generations: 100,
    seed: 42,
    strategies: [
      new NoOpStrategy(),
      new CompactModuleGraftStrategy({ probe: ds }),
    ],
  });

  console.log("# CompactModuleGraft Bake-Off — Issue #2493");
  console.log("");
  console.log(formatBakeOffMarkdown(rows));
}
