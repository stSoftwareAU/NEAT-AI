/**
 * Issue #3974, Step 1 — can `SquashEffectivenessTracker`'s existing role
 * buckets already see the deep chain?
 *
 * The issue asks this before any new rule is added: if the tracker can be
 * tuned into doing the job, the bias is not needed. The answer is measured on
 * the GRQ-lineage creature `test/data/grq-23-forests-constants.json`, and it is
 * structural rather than statistical — a role is
 * `layer bucket × fan-in bucket`, and **neither term mentions chain
 * membership**, so a chain member and an ordinary mid-depth neuron of the same
 * fan-in are the same role however many samples the tracker collects.
 *
 * `docs/evidence/deep-chain-squash-bias-3974-step1.md` carries the population
 * figures that go with this: 26 of the depth-34→61 run's 28 members land in
 * three `mid` roles holding 1,229 mutable neurons between them, so they are
 * 0.8–3.4% of the samples those roles ever see.
 */

import { assert, assertEquals } from "@std/assert";
import { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { DEFAULT_SQUASH_EFFECTIVENESS_CONFIG } from "@config/SquashEffectivenessConfig.ts";
import { SquashEffectivenessTracker } from "@neat/SquashEffectivenessTracker.ts";
import { computeLayerAssignments } from "@propagate/LayerAssignment.ts";
import { longestSerialChain } from "@propagate/SerialChains.ts";

Deno.test("Step 1 - the tracker's roles cannot distinguish a deep-chain neuron", async () => {
  const json = JSON.parse(
    await Deno.readTextFile("./test/data/grq-23-forests-constants.json"),
  ) as CreatureExport;
  const creature = Creature.fromJSON(json);

  const chain = longestSerialChain(creature);
  assert(chain !== undefined, "the GRQ creature carries a serial chain");
  const chainIndexes = new Set(chain.members.map((m) => m.index));

  const tracker = new SquashEffectivenessTracker(
    DEFAULT_SQUASH_EFFECTIVENESS_CONFIG,
  );

  // A member well inside the run: deep, hidden, and the structure #3972 says
  // makes a zero derivative unrecoverable.
  const member = chain.members.find((m) => m.depth === 47);
  assert(member !== undefined, "the run spans depth 47");
  const memberRole = tracker.computeRole(creature, member.index);
  assertEquals(memberRole.layer, "mid", "the run sits in the mid bucket");

  // Find a neuron of the same depth band and fan-in that is *not* in the run.
  const layers = computeLayerAssignments(creature);
  const outputStart = creature.neurons.length - creature.output;
  const memberFanIn = creature.inwardConnections(member.index).length;
  let twin = -1;
  for (const [depth, indexes] of layers) {
    if (depth < 2 || depth > 30) continue;
    for (const index of indexes) {
      if (index >= outputStart || chainIndexes.has(index)) continue;
      if (creature.inwardConnections(index).length !== memberFanIn) continue;
      twin = index;
      break;
    }
    if (twin >= 0) break;
  }
  assert(twin >= 0, "the creature holds an ordinary mid neuron of that fan-in");

  const twinRole = tracker.computeRole(creature, twin);
  assertEquals(
    twinRole,
    memberRole,
    "an ordinary mid-depth neuron and a chain member share one role, so no " +
      "amount of tuning lets the tracker bias the chain specifically",
  );
});
