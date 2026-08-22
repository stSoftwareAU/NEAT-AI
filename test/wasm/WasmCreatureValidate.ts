/**
 * @module
 *
 * The fail-loud half of the WASM creature validator (Issue #3803).
 *
 * `creatureValidate` has no TypeScript fallback, so an unloadable bundle must
 * **throw** — the worst failure mode this change could have is a creature
 * silently treated as valid because validation never ran. These tests drive
 * the bridge with an unavailable bundle and with answers core would never
 * give, and assert every one of them raises rather than returning a verdict.
 */

import { assert, assertEquals, assertThrows } from "@std/assert";
import { WasmError } from "@errors/WasmError.ts";
import { ensureWasmActivation } from "@wasm/EnsureWasmActivation.ts";
import {
  coreValidateCreature,
  type CreatureValidateRequest,
} from "@wasm/WasmCreatureValidate.ts";

// This module imports the bridge alone, so nothing pulls in the auto-init that
// `Creature` would; the two cases below drive the real bundle deliberately.
await ensureWasmActivation();

/** A healthy one-in, one-out creature in the runtime request shape. */
function healthyRequest(): CreatureValidateRequest {
  return {
    runtimeCreature: {
      input: 1,
      output: 1,
      neurons: [
        { type: "input", id: 0, uuid: "input-0" },
        {
          type: "output",
          id: -1,
          uuid: "output-0",
          bias: 0,
          squash: "IDENTITY",
        },
      ],
      synapses: [{ from: 0, to: 1 }],
    },
  };
}

Deno.test("coreValidateCreature: an unavailable bundle throws instead of passing", () => {
  const loadError = new Error("wasm_activation_bg.wasm: PermissionDenied");

  const error = assertThrows(
    () => coreValidateCreature(healthyRequest(), null, loadError),
    WasmError,
  ) as WasmError;

  assertEquals(error.reason, "MODULE_NOT_LOADED");
  assert(
    error.message.includes("PermissionDenied"),
    `the loader error must travel with the throw: ${error.message}`,
  );
  assert(
    error.message.includes("no TypeScript fallback"),
    `the message must say validation could not run: ${error.message}`,
  );
  assertEquals(error.cause, loadError);
});

Deno.test("coreValidateCreature: an unavailable bundle with no recorded cause still throws", () => {
  const error = assertThrows(
    () => coreValidateCreature(healthyRequest(), null, null),
    WasmError,
  ) as WasmError;

  assertEquals(error.reason, "MODULE_NOT_LOADED");
  assert(
    error.message.includes("never initialised"),
    `an absent cause must be stated, not hidden: ${error.message}`,
  );
});

Deno.test("coreValidateCreature: a malformed answer is a bridge fault, not a verdict", () => {
  const error = assertThrows(
    () =>
      coreValidateCreature(
        healthyRequest(),
        () =>
          JSON.stringify({
            ok: false,
            failure: {
              class: "ValidationError",
              reason: "OTHER",
              message: "MALFORMED_REQUEST: unknown field `verbose`",
              neuronIndex: null,
              synapseIndex: null,
              malformed: true,
            },
          }),
      ),
    WasmError,
  ) as WasmError;

  assertEquals(error.reason, "INVALID_REQUEST");
  assert(
    error.message.includes("MALFORMED_REQUEST"),
    `the refusal must be quoted: ${error.message}`,
  );
});

Deno.test("coreValidateCreature: an answer that is not JSON throws", () => {
  const error = assertThrows(
    () => coreValidateCreature(healthyRequest(), () => "not json"),
    WasmError,
  ) as WasmError;
  assertEquals(error.reason, "INVALID_REQUEST");
});

Deno.test("coreValidateCreature: a healthy answer with no counters throws", () => {
  const error = assertThrows(
    () =>
      coreValidateCreature(
        healthyRequest(),
        () => JSON.stringify({ ok: true }),
      ),
    WasmError,
  ) as WasmError;
  assertEquals(error.reason, "INVALID_REQUEST");
});

Deno.test("coreValidateCreature: a failure with no detail throws", () => {
  const error = assertThrows(
    () =>
      coreValidateCreature(
        healthyRequest(),
        () => JSON.stringify({ ok: false }),
      ),
    WasmError,
  ) as WasmError;
  assertEquals(error.reason, "INVALID_REQUEST");
});

Deno.test("coreValidateCreature: the real bundle counts a healthy creature", () => {
  const result = coreValidateCreature(healthyRequest());
  assertEquals(result.failure, undefined);
  assertEquals(result.stats, {
    input: 1,
    constant: 0,
    hidden: 0,
    output: 1,
    connections: 1,
  });
});

Deno.test("coreValidateCreature: the real bundle names the first violated rule", () => {
  const request = healthyRequest();
  request.runtimeCreature.neurons[1].bias = "NaN";

  const result = coreValidateCreature(request);
  assertEquals(result.stats, undefined);
  assertEquals(result.failure?.class, "ValidationError");
  assertEquals(result.failure?.reason, "OTHER");
  assertEquals(result.failure?.message, "-1) invalid bias: NaN");
  assertEquals(result.failure?.neuronIndex, 1);
  assertEquals(result.failure?.synapseIndex, null);
});
