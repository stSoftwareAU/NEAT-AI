/**
 * Issue #2482 — Diagnostic regression test for the
 * `WasmCreatureActivation.create` `RuntimeError: unreachable` trap.
 *
 * Background:
 *
 *   GRQ-16 production logs (`@stsoftware/neat-ai@3.1.37`) show the trap firing
 *   40 times during a single training run, with the user-frame stack:
 *
 *     at WasmCreatureActivation.create
 *        (src/wasm/WasmActivation.ts:123:23)
 *     at WasmCompilationCacheImpl.getOrCompile
 *        (src/wasm/WasmCompilationCache.ts:271:37)
 *     at getOrCompileWasmModule
 *        (src/wasm/WasmCompilationCache.ts:586:31)
 *     at Module.activateAndTraceWasm
 *        (src/creature/CreatureActivation.ts:248:37)
 *     at Creature.activateAndTrace
 *
 *   Inner WASM frames (all in module `0017f6ba`):
 *     0x2cef9 → 0x307c0 → 0x51f6d → 0x4a179
 *
 *   Decoded against the pinned `wasm_activation_bg.wasm`
 *   (`neatCore.rev = 925d4b7f`), these addresses map to:
 *
 *     0x4a179 → func[169] `compilednetwork_new` (offset 0x6ba)
 *               — the `CompiledNetwork::new` constructor
 *     0x51f6d → func[191] — Rust `slice_index_len_fail`-style panic
 *               (loads the source-location string and length and tail-calls
 *               the panic formatter)
 *     0x307c0 → func[133] — `core::panicking::panic_fmt`
 *     0x2cef9 → func[90]  — innermost panic plumbing → `unreachable`
 *
 *   The originating call site at `0x4a179` sits inside the per-non-input-neuron
 *   loop in `CompiledNetwork::new`. The two arguments passed to the panic
 *   helper at that site are `len` and `cap`, the classic shape of a
 *   `Vec<T>::push` / slice-index bounds panic. The panic fires when the
 *   constructor tries to size a buffer of `num_non_inputs = num_neurons -
 *   num_inputs` entries while `num_inputs > num_neurons` — the unsigned
 *   subtraction wraps to a huge value, and the subsequent allocation/loop
 *   traps.
 *
 *   This was confirmed empirically by feeding `CompiledNetwork::new` a
 *   minimal hand-built header `[num_neurons=u32, num_inputs=u32]` with
 *   `num_inputs > num_neurons`. The resulting JS trap stack matches the
 *   production frame chain byte-for-byte (off-by-one column reporting between
 *   the JSR-hosted source and the local copy):
 *
 *     production (0-indexed): 0x2cef9, 0x307c0, 0x51f6d, 0x4a179
 *     this repro  (1-indexed): 184058,  198593,  335726,  303482
 *
 *   Both translate to the same call chain:
 *     `compilednetwork_new` → `slice_index_len_fail` → `panic_fmt` →
 *     `unreachable`.
 *
 *   The "error magnitude (1.45e+10 … 1.52e+30) exceeds reasonable threshold"
 *   discovery warnings co-occurring with the trap in the production log are
 *   *correlated, not causal*. Probing the WASM constructor with `Infinity`,
 *   `NaN`, and `1e+30`-magnitude weights/biases confirms the WASM path does
 *   not trap on extreme finite values:
 *
 *     - Non-finite *weights* are rejected at the JS layer by the `Synapse`
 *       constructor's `Number.isFinite(weight)` assertion before they ever
 *       reach `WasmCompilationCache.compileFromTemplate`. They cannot reach
 *       WASM via the public Creature API.
 *     - Non-finite *biases* survive to the binary template (`setFloat64` does
 *       not block them) but the WASM constructor accepts them — `f32.demote_f64`
 *       converts `±Infinity → ±FLT_MAX`, `NaN → NaN` — and emits no trap.
 *     - Finite extreme weights (e.g. `1e+30`) likewise compile and activate
 *       without trapping.
 *
 *   The actual trigger is a *header invariant violation* in the binary
 *   produced by `WasmCompilationCache.buildTemplate`. If `creature.input`
 *   ever exceeds `creature.neurons.length` — for example after a structural
 *   mutation or compaction step that prunes neurons without resyncing the
 *   `input` count — the resulting header lands `num_inputs > num_neurons` and
 *   the WASM constructor traps as described.
 *
 * Acceptance criteria covered by this test:
 *
 *   1. Reproduces the trap deterministically against the pinned WASM bundle.
 *   2. Asserts the JS-visible failure surface (`create` returns `null` after
 *      the catch in `WasmActivation.ts:130` swallows the `RuntimeError`).
 *   3. Asserts the trap surfaces as `RuntimeError: unreachable` when the
 *      constructor is invoked directly (without the catch wrapper), so that
 *      the address chain remains observable in CI logs for any future
 *      regression hunt.
 *   4. Confirms that finite extreme weights and `Infinity`/`NaN` biases —
 *      the originally-suspected root cause — do *not* trip the trap, so the
 *      diagnostic is not muddled by red herrings.
 *
 * The test is hermetic: it builds its own binary buffers and does not depend
 * on training data, RNG, or persisted creatures.
 */

import { assert, assertEquals, assertStringIncludes } from "@std/assert";
import { ensureWasmActivation } from "@wasm/EnsureWasmActivation.ts";
import { isWasmActivationAvailable } from "@wasm/WasmModuleLoader.ts";
import { getCompiledNetworkClass } from "@wasm/WasmModuleLoader.ts";
import { WasmCreatureActivation } from "@wasm/WasmActivation.ts";
import { SquashType } from "@wasm/SquashType.ts";

/**
 * Build a `CompiledNetwork::new` binary buffer matching the documented format
 * in `wasm_activation/pkg/wasm_activation.d.ts`:
 *
 *   - `u32` num_neurons (LE)
 *   - `u32` num_inputs  (LE)
 *   - For each non-input neuron:
 *     - `f64` bias
 *     - `u8`  squash_type
 *     - `u8`  is_constant
 *     - `u16` num_synapses
 *     - For each synapse:
 *       - `u16` from_index
 *       - `u8`  synapse_type
 *       - `u8`  padding
 *       - `f64` weight
 */
interface BinSynapse {
  from: number;
  type: number;
  weight: number;
}
interface BinNeuron {
  bias: number;
  squash: SquashType;
  isConstant: boolean;
  synapses: BinSynapse[];
}

function buildBinary(
  numNeurons: number,
  numInputs: number,
  neurons: BinNeuron[],
): Uint8Array {
  const totalSyn = neurons.reduce((acc, n) => acc + n.synapses.length, 0);
  const size = 8 + neurons.length * 12 + totalSyn * 12;
  const buf = new ArrayBuffer(size);
  const view = new DataView(buf);
  let off = 0;
  view.setUint32(off, numNeurons, true);
  off += 4;
  view.setUint32(off, numInputs, true);
  off += 4;
  for (const n of neurons) {
    view.setFloat64(off, n.bias, true);
    off += 8;
    view.setUint8(off, n.squash);
    off += 1;
    view.setUint8(off, n.isConstant ? 1 : 0);
    off += 1;
    view.setUint16(off, n.synapses.length, true);
    off += 2;
    for (const s of n.synapses) {
      view.setUint16(off, s.from, true);
      off += 2;
      view.setUint8(off, s.type);
      off += 1;
      view.setUint8(off, 0);
      off += 1;
      view.setFloat64(off, s.weight, true);
      off += 8;
    }
  }
  return new Uint8Array(buf);
}

/**
 * Minimal valid baseline — 2 inputs, 1 hidden, 1 output. Used as a control
 * case to confirm the test infrastructure is wired up correctly before we
 * exercise the trap-triggering inputs.
 */
function validBinary(): Uint8Array {
  return buildBinary(4, 2, [
    {
      bias: 0,
      squash: SquashType.Identity,
      isConstant: false,
      synapses: [
        { from: 0, type: 0, weight: 0.5 },
        { from: 1, type: 0, weight: 0.5 },
      ],
    },
    {
      bias: 0,
      squash: SquashType.Identity,
      isConstant: false,
      synapses: [{ from: 2, type: 0, weight: 1.0 }],
    },
  ]);
}

Deno.test("Issue #2482: valid baseline binary compiles successfully", async () => {
  await ensureWasmActivation();
  assert(isWasmActivationAvailable(), "WASM must be available for this test");

  const wasm = WasmCreatureActivation.create({
    data: validBinary(),
    numNeurons: 4,
    numInputs: 2,
    numOutputs: 1,
    numSynapses: 3,
  });
  assert(wasm !== null, "valid binary should compile without trapping");
});

Deno.test("Issue #2482: num_inputs > num_neurons triggers the production trap", async () => {
  await ensureWasmActivation();
  assert(isWasmActivationAvailable(), "WASM must be available for this test");

  // Header-only buffer with num_inputs > num_neurons. This is the smallest
  // possible repro — the trap fires before the constructor reads any
  // per-neuron data.
  const buf = new Uint8Array(8);
  const view = new DataView(buf.buffer);
  view.setUint32(0, 1, true); // num_neurons
  view.setUint32(4, 2, true); // num_inputs (exceeds num_neurons by 1)

  // Path 1 — direct constructor call: surface the raw RuntimeError so the
  // WASM trap address chain is observable. This mirrors what the production
  // worker sees before the catch in WasmCreatureActivation.create swallows it.
  const CompiledNetwork = getCompiledNetworkClass();
  assert(CompiledNetwork !== null, "CompiledNetwork class must be loaded");
  let trapStack = "";
  try {
    new CompiledNetwork(buf);
    throw new Error(
      "expected num_inputs>num_neurons header to trap CompiledNetwork::new, " +
        "but the constructor returned successfully",
    );
  } catch (e) {
    const err = e as Error;
    assert(
      err.constructor.name === "RuntimeError",
      `expected RuntimeError, got ${err.constructor.name}: ${err.message}`,
    );
    assertStringIncludes(
      err.message,
      "unreachable",
      "WASM trap should report 'unreachable'",
    );
    trapStack = err.stack ?? "";
  }

  // The stack should contain four `wasm_activation_bg.wasm:` frames matching
  // the production trap chain (within ±1 column for 0-vs-1-indexing). We
  // assert at least four such frames are present rather than pinning exact
  // offsets, because the addresses shift if the pinned core revision moves.
  const wasmFrames = trapStack.split("\n").filter((ln) =>
    ln.includes("wasm_activation_bg.wasm:")
  );
  assert(
    wasmFrames.length >= 4,
    `expected ≥4 WASM frames in the trap stack, got ${wasmFrames.length}:\n${trapStack}`,
  );

  // Path 2 — production-shaped surface: WasmCreatureActivation.create swallows
  // the trap and returns null after logging "Failed to create WASM activation:
  // RuntimeError: unreachable" — the exact log line GRQ-16 emits 40 times.
  const wasm = WasmCreatureActivation.create({
    data: buf,
    numNeurons: 1,
    numInputs: 2,
    numOutputs: 0,
    numSynapses: 0,
  });
  assertEquals(
    wasm,
    null,
    "WasmCreatureActivation.create must surface trap as null (not throw)",
  );
});

Deno.test("Issue #2482: extreme finite weights do NOT trap CompiledNetwork::new", async () => {
  await ensureWasmActivation();
  assert(isWasmActivationAvailable(), "WASM must be available for this test");

  // 1e+30 magnitude — covers the 1.45e+10 to 1.52e+30 range called out in the
  // GRQ-16 "error magnitude exceeds reasonable threshold" warnings. These
  // warnings co-occurred with the trap but, as this assertion proves, are NOT
  // its cause.
  const wasm = WasmCreatureActivation.create({
    data: buildBinary(4, 2, [
      {
        bias: 1e30,
        squash: SquashType.Identity,
        isConstant: false,
        synapses: [
          { from: 0, type: 0, weight: 1e30 },
          { from: 1, type: 0, weight: -1e30 },
        ],
      },
      {
        bias: 0,
        squash: SquashType.Identity,
        isConstant: false,
        synapses: [{ from: 2, type: 0, weight: 1.0 }],
      },
    ]),
    numNeurons: 4,
    numInputs: 2,
    numOutputs: 1,
    numSynapses: 3,
  });
  assert(
    wasm !== null,
    "1e+30 magnitude weights/biases must not trap the constructor",
  );
});

Deno.test("Issue #2482: non-finite biases do NOT trap CompiledNetwork::new", async () => {
  await ensureWasmActivation();
  assert(isWasmActivationAvailable(), "WASM must be available for this test");

  // Note: non-finite *weights* cannot reach the WASM compile path through the
  // public Creature API — the Synapse constructor enforces
  // `Number.isFinite(weight)` and throws AssertionError before any binary is
  // built. This case therefore exercises only non-finite biases, which the
  // public API does not block in the same way.
  for (const bias of [Infinity, -Infinity, NaN]) {
    const wasm = WasmCreatureActivation.create({
      data: buildBinary(4, 2, [
        {
          bias: bias,
          squash: SquashType.Identity,
          isConstant: false,
          synapses: [
            { from: 0, type: 0, weight: 0.5 },
            { from: 1, type: 0, weight: 0.5 },
          ],
        },
        {
          bias: 0,
          squash: SquashType.Identity,
          isConstant: false,
          synapses: [{ from: 2, type: 0, weight: 1.0 }],
        },
      ]),
      numNeurons: 4,
      numInputs: 2,
      numOutputs: 1,
      numSynapses: 3,
    });
    assert(
      wasm !== null,
      `bias=${bias} must not trap CompiledNetwork::new (the WASM ` +
        `constructor accepts non-finite biases via f32.demote_f64)`,
    );
  }
});
