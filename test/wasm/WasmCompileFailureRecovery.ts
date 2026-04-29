/**
 * Issue #2483 — Recovery for `WasmCreatureActivation.create` traps and
 * pruning of neurons whose error magnitude exceeds the harmful threshold.
 *
 * Two layers of defence are exercised here:
 *
 *   1. **Call-site recovery.** `WasmCreatureActivation.create` swallows the
 *      `RuntimeError: unreachable` trap and returns `null`. The compilation
 *      cache emits one structured warning per offending creature uuid (no
 *      40-line spam). `activateWasm` / `activateAndTraceWasm` surface a
 *      typed `WasmError` so the training loop can drop the creature
 *      gracefully — `runSingleEpoch` catches the typed error and returns
 *      `trainingStopped=true` instead of crashing the worker.
 *
 *   2. **Pre-compile pruning.** When the squash analyser detects a neuron
 *      whose error magnitude exceeds `MAX_REASONABLE_SQUASH_ERROR` (1e10),
 *      it now pushes a `CandidateHarmfulNeuron` to the supplied sink. The
 *      surrounding pipeline routes those candidates through the existing
 *      `removeHarmfulNeuron` helper rather than only logging "this neuron
 *      should be removed".
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { Creature } from "@creature";
import { WasmError } from "@errors/WasmError.ts";
import { activateWasm } from "@creature/CreatureActivation.ts";
import { initWasmActivation } from "@wasm/WasmModuleLoader.ts";
import {
  getLastWasmCreateFailure,
  resetFailedCompileDedup,
  resetLastWasmCreateFailure,
  WasmCreatureActivation,
} from "@wasm/mod.ts";
import { SquashType } from "@wasm/SquashType.ts";
import {
  analyzeSelectedNeuronsForHarmfulRemoval,
  findCandidateSquash,
} from "@architecture/ErrorGuidedStructuralEvolution/DiscoverSquashAnalysis.ts";
import { buildWireToRuntimeIdMap } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryWireIdentity.ts";
import type { CandidateHarmfulNeuron } from "@architecture/ErrorGuidedStructuralEvolution/DiscoverStructureTypes.ts";
import { removeHarmfulNeuron } from "@architecture/ErrorGuidedStructuralEvolution/DiscoveryNeuronRemoval.ts";

await initWasmActivation();

/**
 * Build a `CompiledNetwork::new` binary buffer matching the format documented
 * in `wasm_activation/pkg/wasm_activation.d.ts`. Lifted from the diagnostic
 * test in #2482 — kept local to avoid cross-test imports.
 */
function buildTrapBinary(): Uint8Array {
  // Smallest possible repro: header-only buffer with num_inputs > num_neurons.
  // The WASM constructor traps before reading any per-neuron data because the
  // unsigned `num_neurons - num_inputs` subtraction wraps around.
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 1, true); // num_neurons
  view.setUint32(4, 2, true); // num_inputs (exceeds num_neurons by 1)
  return buf;
}

/**
 * Build a creature whose synapses point at a non-existent `from` neuron index.
 * The resulting WASM binary compiles cleanly but traps inside `activate` when
 * the kernel tries to read past the activation array. Used to drive
 * `activateWasm` into its `WasmError` recovery path.
 */
function createCorruptedActivationCreature(): Creature {
  const creature = new Creature(2, 1);
  creature.fix();
  for (const synapse of creature.synapses) {
    synapse.from = 9999;
  }
  creature.clearCache();
  creature.cachedWasmActivation = undefined;
  return creature;
}

Deno.test(
  "Issue #2483: WasmCreatureActivation.create returns null AND records the trap message on bad binary",
  () => {
    resetLastWasmCreateFailure();
    const wasm = WasmCreatureActivation.create({
      data: buildTrapBinary(),
      numNeurons: 1,
      numInputs: 2,
      numOutputs: 0,
      numSynapses: 0,
    });
    assertEquals(
      wasm,
      null,
      "expected create() to swallow the RuntimeError and return null",
    );
    const failure = getLastWasmCreateFailure();
    assert(failure !== null, "expected the failure to be recorded");
    assert(
      failure!.message.length > 0,
      "expected the captured trap message to be non-empty",
    );
  },
);

Deno.test(
  "Issue #2483: repeated bad-binary calls do not throw — they keep returning null",
  () => {
    resetLastWasmCreateFailure();
    for (let i = 0; i < 10; i++) {
      const wasm = WasmCreatureActivation.create({
        data: buildTrapBinary(),
        numNeurons: 1,
        numInputs: 2,
        numOutputs: 0,
        numSynapses: 0,
      });
      assertEquals(wasm, null, `iteration ${i}: should return null`);
    }
    // Recording is overwritten each call but never throws — the surrounding
    // worker can therefore safely retry without crashing.
    const failure = getLastWasmCreateFailure();
    assert(failure !== null);
  },
);

Deno.test(
  "Issue #2483: activateWasm surfaces WasmError so training can drop the creature without crashing",
  () => {
    resetFailedCompileDedup();
    resetLastWasmCreateFailure();
    const creature = createCorruptedActivationCreature();
    const input = new Float32Array([0.1, 0.2]);

    // The trap is converted to a typed WasmError — no RuntimeError leaks
    // out of the activation path (criterion #1 of the issue).
    const err = assertThrows(
      () => activateWasm(creature, input, false),
      WasmError,
    );
    assertEquals(
      (err as WasmError).reason,
      "ACTIVATION_FAILED",
      "WASM trap must surface as ACTIVATION_FAILED, never AssertionError or raw RuntimeError",
    );
  },
);

Deno.test(
  "Issue #2483: a regular creature still creates an activation successfully (control)",
  () => {
    resetLastWasmCreateFailure();
    const baseline = WasmCreatureActivation.create({
      // num_neurons=4 (2 input + 1 hidden + 1 output), num_inputs=2,
      // 1 synapse on the hidden neuron and 1 on the output.
      data: (() => {
        const totalSyn = 3; // matches numSynapses below
        const size = 8 + 2 * 12 + totalSyn * 12;
        const buf = new ArrayBuffer(size);
        const view = new DataView(buf);
        let off = 0;
        view.setUint32(off, 4, true);
        off += 4;
        view.setUint32(off, 2, true);
        off += 4;
        // hidden neuron
        view.setFloat64(off, 0, true);
        off += 8;
        view.setUint8(off, SquashType.Identity);
        off += 1;
        view.setUint8(off, 0);
        off += 1;
        view.setUint16(off, 2, true);
        off += 2;
        // synapse from=0
        view.setUint16(off, 0, true);
        off += 2;
        view.setUint8(off, 0);
        off += 1;
        view.setUint8(off, 0);
        off += 1;
        view.setFloat64(off, 0.5, true);
        off += 8;
        // synapse from=1
        view.setUint16(off, 1, true);
        off += 2;
        view.setUint8(off, 0);
        off += 1;
        view.setUint8(off, 0);
        off += 1;
        view.setFloat64(off, 0.5, true);
        off += 8;
        // output neuron
        view.setFloat64(off, 0, true);
        off += 8;
        view.setUint8(off, SquashType.Identity);
        off += 1;
        view.setUint8(off, 0);
        off += 1;
        view.setUint16(off, 1, true);
        off += 2;
        // synapse from=2
        view.setUint16(off, 2, true);
        off += 2;
        view.setUint8(off, 0);
        off += 1;
        view.setUint8(off, 0);
        off += 1;
        view.setFloat64(off, 1.0, true);
        off += 8;
        return new Uint8Array(buf);
      })(),
      numNeurons: 4,
      numInputs: 2,
      numOutputs: 1,
      numSynapses: 3,
    });
    assert(baseline !== null, "valid binary should produce an activation");
    baseline!.free();
  },
);

Deno.test(
  "Issue #2483: findCandidateSquash promotes over-threshold neurons to harmful sink",
  () => {
    const creature = Creature.fromJSON({
      input: 1,
      output: 1,
      neurons: [
        { type: "hidden", uuid: "hidden-1", squash: "IDENTITY", bias: 0 },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "hidden-1", weight: 0.5 },
        { fromUUID: "hidden-1", toUUID: "output-0", weight: 0.5 },
      ],
    });
    const hiddenId = buildWireToRuntimeIdMap(creature).get("hidden-1")!;

    // Records whose `value + avgError` are massive — this drives
    // baselineActivationError above MAX_REASONABLE_SQUASH_ERROR (1e10).
    const records = [
      { value: 1, activation: 0, errors: [1e16] },
      { value: 1, activation: 0, errors: [1e16] },
    ];
    const harmfulSink: CandidateHarmfulNeuron[] = [];

    const candidate = findCandidateSquash(
      creature,
      hiddenId,
      records,
      () => 1,
      false,
      () => {},
      harmfulSink,
    );

    assertEquals(
      candidate,
      undefined,
      "no squash candidate should be returned when error magnitude exceeds the threshold",
    );
    assertEquals(
      harmfulSink.length,
      1,
      "exactly one harmful candidate should be pushed",
    );
    assertEquals(harmfulSink[0].neuronUuid, "hidden-1");
    assert(
      harmfulSink[0].errorMagnitude > 1e10,
      `errorMagnitude should exceed 1e10, got ${harmfulSink[0].errorMagnitude}`,
    );
  },
);

Deno.test(
  "Issue #2483: harmful candidate from squash sink is removable via removeHarmfulNeuron",
  async () => {
    const creature = Creature.fromJSON({
      input: 1,
      output: 1,
      neurons: [
        {
          type: "hidden",
          uuid: "harmful-target",
          squash: "IDENTITY",
          bias: 0,
        },
        { type: "output", uuid: "output-0", squash: "IDENTITY", bias: 0 },
      ],
      synapses: [
        { fromUUID: "input-0", toUUID: "harmful-target", weight: 0.5 },
        { fromUUID: "harmful-target", toUUID: "output-0", weight: 0.5 },
        // Backup synapse so the output remains reachable after pruning.
        { fromUUID: "input-0", toUUID: "output-0", weight: 0.5 },
      ],
    });
    const harmfulCandidates = await analyzeSelectedNeuronsForHarmfulRemoval(
      creature,
      [buildWireToRuntimeIdMap(creature).get("harmful-target")!],
      () =>
        Promise.resolve([
          { value: 1, activation: 0, errors: [1e16] },
          { value: 1, activation: 0, errors: [1e16] },
        ]),
      "/tmp/discovery-2483",
      false,
      () => {},
    );
    assert(
      harmfulCandidates && harmfulCandidates.length === 1,
      "expected one harmful candidate from the analyser",
    );

    const repaired = removeHarmfulNeuron(
      "issue-2483-test",
      creature,
      harmfulCandidates[0],
    );
    assert(repaired, "removeHarmfulNeuron should return a repaired creature");
    assertEquals(
      repaired.neurons.find((n) => n.uuid === "harmful-target"),
      undefined,
      "harmful neuron should no longer be present after removal",
    );
  },
);
