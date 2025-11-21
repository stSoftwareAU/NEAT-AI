import { assert, assertAlmostEquals } from "@std/assert";
import { Creature } from "../../src/Creature.ts";
import { CreatureUtil } from "../../src/architecture/CreatureUtils.ts";
import { DiscoverStructure } from "../../src/architecture/ErrorGuidedStructuralEvolution/DiscoverStructure.ts";

Deno.test("Focus selection accounts for squashing function bounds on downstream paths", () => {
  // Create a network with two paths to output:
  // Path A: input-0 -> hidden-direct -> output-0 (weight 1.0, IDENTITY squash)
  // Path B: input-1 -> hidden-chain-1 -> hidden-chain-2 -> hidden-chain-3 -> output-0
  //         (all weights 1.0, but hidden-chain-2 uses TANH which bounds output to [-1, 1])
  //
  // Even if hidden-chain-1 has activation of 1,000,000, TANH at hidden-chain-2 will
  // clamp it to ~1.0, so hidden-chain-1's error impact is bounded by the squash function.

  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-direct", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-chain-1", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-chain-2", squash: "TANH", bias: 0 },
      { type: "hidden", uuid: "hidden-chain-3", squash: "IDENTITY", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      // Direct path with IDENTITY throughout
      { fromUUID: "input-0", toUUID: "hidden-direct", weight: 1.0 },
      { fromUUID: "hidden-direct", toUUID: "output-0", weight: 1.0 },

      // Chain path with TANH bottleneck
      { fromUUID: "input-1", toUUID: "hidden-chain-1", weight: 1.0 },
      { fromUUID: "hidden-chain-1", toUUID: "hidden-chain-2", weight: 1.0 },
      { fromUUID: "hidden-chain-2", toUUID: "hidden-chain-3", weight: 1.0 },
      { fromUUID: "hidden-chain-3", toUUID: "output-0", weight: 1.0 },
    ],
  });

  creature.validate();
  CreatureUtil.makeUUID(creature);

  // Activate with extreme value on chain path
  creature.activate(new Float32Array([0.1, 1000000]));

  // Create DiscoverStructure to access impact calculation
  const discover = new DiscoverStructure(creature, 60);

  // Calculate impact for each hidden neuron using the actual implementation
  // deno-lint-ignore no-explicit-any
  const directImpact = (discover as any).calculateNeuronImpact("hidden-direct");
  // deno-lint-ignore no-explicit-any
  const chain1Impact = (discover as any).calculateNeuronImpact(
    "hidden-chain-1",
  );
  // deno-lint-ignore no-explicit-any
  const chain2Impact = (discover as any).calculateNeuronImpact(
    "hidden-chain-2",
  );
  // deno-lint-ignore no-explicit-any
  const chain3Impact = (discover as any).calculateNeuronImpact(
    "hidden-chain-3",
  );

  // hidden-direct has unbounded path to output (all IDENTITY)
  // Its impact should be close to 1.0 (weight 1.0 * 1.0)
  assertAlmostEquals(
    directImpact,
    1.0,
    0.01,
    "Direct path impact should be ~1.0",
  );

  // hidden-chain-1 feeds into TANH at hidden-chain-2
  // Even with activation of 1,000,000, TANH derivative at that point is ~0
  // So the effective impact is bounded by TANH's derivative range
  assert(
    chain1Impact < 0.1,
    `hidden-chain-1 impact should be severely limited by downstream TANH bottleneck, got ${chain1Impact}`,
  );

  // hidden-chain-2 (the TANH node) has bounded output [-1, 1]
  // Its impact is limited by its own derivative (max ~1.0 at x=0, approaches 0 at extremes)
  // and the downstream weights (1.0 * 1.0 = 1.0)
  assert(
    chain2Impact <= 1.0,
    `hidden-chain-2 impact should be bounded by TANH derivative, got ${chain2Impact}`,
  );

  // hidden-chain-3 is after TANH, so it receives bounded input
  // Its impact should be close to 1.0 (weight 1.0 to output)
  assertAlmostEquals(
    chain3Impact,
    1.0,
    0.01,
    "Post-TANH impact should be ~1.0",
  );

  // The key assertion: neurons before a squashing bottleneck should have
  // much lower impact than neurons on unbounded paths
  assert(
    directImpact > chain1Impact * 10,
    `Direct path impact (${directImpact}) should be >> chain-1 impact (${chain1Impact})`,
  );
});

Deno.test("Focus selection correctly weights neurons by squash-bounded impact", () => {
  // Simpler test: two neurons with same error, but one has TANH on path to output
  const creature = Creature.fromJSON({
    input: 2,
    output: 1,
    neurons: [
      { type: "hidden", uuid: "hidden-unbounded", squash: "IDENTITY", bias: 0 },
      { type: "hidden", uuid: "hidden-tanh", squash: "TANH", bias: 0 },
      { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
    ],
    synapses: [
      { fromUUID: "input-0", toUUID: "hidden-unbounded", weight: 1.0 },
      { fromUUID: "hidden-unbounded", toUUID: "output-0", weight: 1.0 },
      { fromUUID: "input-1", toUUID: "hidden-tanh", weight: 1.0 },
      { fromUUID: "hidden-tanh", toUUID: "output-0", weight: 1.0 },
    ],
  });

  creature.validate();
  CreatureUtil.makeUUID(creature);

  // Activate with large value to push TANH into saturation
  creature.activate(new Float32Array([5.0, 5.0]));

  // Create DiscoverStructure to access impact calculation
  const discover = new DiscoverStructure(creature, 60);

  // deno-lint-ignore no-explicit-any
  const unboundedImpact = (discover as any).calculateNeuronImpact(
    "hidden-unbounded",
  );
  // deno-lint-ignore no-explicit-any
  const tanhImpact = (discover as any).calculateNeuronImpact("hidden-tanh");

  // IDENTITY has derivative of 1.0, TANH at x=5 has derivative ~0.0001
  // So even though both have weight 1.0 to output, the TANH neuron's
  // effective impact is much lower due to saturation
  assert(
    unboundedImpact > tanhImpact * 100,
    `Unbounded impact (${unboundedImpact}) should be >> TANH impact (${tanhImpact}) when saturated`,
  );
});
