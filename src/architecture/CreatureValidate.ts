/**
 * @module
 *
 * Structural and topological validation for a creature. {@link creatureValidate}
 * checks the invariants a healthy topology must hold — no self or backward
 * connections, no duplicate synapses, every hidden neuron wired in and out,
 * finite biases — and raises a {@link TopologyError} or {@link ValidationError}
 * when a mutation, breeding or discovery step produces an invalid creature.
 *
 * ## Where the rules live (Issue #3803)
 *
 * The rules are **not** here. They live in NEAT-AI-core's `creature_validate`
 * and reach this file over the JSON bridge in
 * {@link module:src/wasm/WasmCreatureValidate}, so NEAT-AI, NEAT-AI-Forests,
 * NEAT-AI-Lamarck and NEAT-AI-Backpropagation all read one set of rules rather
 * than four ports of them. What stays in TypeScript is only what cannot cross
 * the boundary:
 *
 * 1. {@link hostOnlyNeuronChecks} — `neuron.validate()`, the `neuron.index`
 *    cache and `neuron.creature` object identity (Issue #3802).
 * 2. Marshalling the creature and the options across, and putting back the one
 *    value JSON cannot carry (see `CreatureValidateMarshal.ts`).
 * 3. Rehydrating core's structured failure into the `TopologyError` /
 *    `ValidationError` callers already catch. `class`, `reason` and `message`
 *    come straight from core — there is no translation table.
 * 4. {@link debugWrite}, a diagnostics side effect of `creature.DEBUG`.
 *
 * There is **no fallback**. If the bundle cannot be loaded the call throws a
 * `WasmError` carrying the loader's own failure: a creature is never treated
 * as valid because validation could not run.
 *
 * ```mermaid
 * flowchart LR
 *   C["creature + options"] --> M["marshal → runtimeCreature JSON"]
 *   M --> W["NEAT-AI-core creature_validate (WASM)"]
 *   W -- "ok + stats" --> H["host-only walk"] --> S["stats"]
 *   W -- "failure(class, reason, message, neuronIndex)" --> H2["host-only walk<br/>up to neuronIndex"]
 *   H2 --> T["TopologyError / ValidationError"]
 *   W -- "bundle unavailable" --> E["WasmError — throw, never skip"]
 * ```
 *
 * ## Throw-ordering contract
 *
 * `creatureValidate` is first-failure-wins, so the order the two halves
 * interleave is observable and is reproduced here from the failure's
 * `neuronIndex`. For each neuron, in array order:
 *
 * 1. if core's failure is that neuron's, it is thrown; otherwise
 * 2. {@link hostOnlyNeuronChecks} runs for the same neuron — `neuron.validate()`,
 *    then the `index` cache field, then the owning-creature identity.
 *
 * So a neuron breaching both halves throws its **rule** error, and a host-only
 * breach on neuron *i* throws before any rule failure reported against neuron
 * *i + 1*. A failure that names no neuron — the synapse rules, the neuron-type
 * counts, the `connections` option, the memetic cross-references — is thrown
 * only after every neuron has passed the host-only half, matching the
 * TypeScript rules it replaces.
 *
 * The one ordering difference is the three declared-width rules (the `neurons`
 * option, and `input` / `output` being positive integers). They named no
 * neuron in TypeScript either, so a creature that breaks one of them *and* has
 * a host-only breach now reports the host-only breach first. Both are still
 * reported, both still throw, and no creature passes that did not before.
 */
import type { Creature } from "@creature";
import type { Neuron } from "@architecture/Neuron.ts";
import { TopologyError, type TopologyErrorReason } from "@errors/TopologyError.ts";
import {
  ValidationError,
  type ValidationErrorName,
} from "@errors/ValidationError.ts";
import { getDiagnosticsDir } from "@utils/Diagnostics.ts";
import {
  type CreatureValidateOptions,
  marshalCreatureValidateRequest,
  type MarshalledRequest,
  restoreSubstitutedId,
} from "@architecture/CreatureValidateMarshal.ts";
import {
  type CoreValidationFailure,
  type CoreValidationStats,
  coreValidateCreature,
} from "@wasm/WasmCreatureValidate.ts";

/**
 * Validate the creature.
 *
 * @param creature The creature to validate.
 * @param options Specific values to check.
 * @returns The five counters core counted while walking the creature.
 * @throws {ValidationError} / {@link TopologyError} for the first violated rule.
 * @throws {WasmError} When the NEAT-AI-core bundle cannot be loaded, so
 *   validation could not run at all.
 */
export function creatureValidate(
  creature: Creature,
  options?: CreatureValidateOptions,
): CoreValidationStats {
  const marshalled = marshalCreatureValidateRequest(creature, options);
  const result = coreValidateCreature(marshalled.request);
  const failure = result.failure;

  for (let indx = 0; indx < creature.neurons.length; indx++) {
    if (failure && failure.neuronIndex === indx) {
      throw rehydrate(creature, failure, marshalled);
    }
    hostOnlyNeuronChecks(creature, creature.neurons[indx], indx);
  }

  if (failure) {
    throw rehydrate(creature, failure, marshalled);
  }

  // `coreValidateCreature` answers with one or the other; a response carrying
  // neither is already refused there as a bridge fault.
  return result.stats as CoreValidationStats;
}

/**
 * Turn core's structured failure back into the error callers catch.
 *
 * `class`, `reason` and `message` are core's own words (core issue #559), so
 * this is a constructor call rather than a translation — the only edit is
 * putting back an id JSON could not carry.
 */
function rehydrate(
  creature: Creature,
  failure: CoreValidationFailure,
  marshalled: MarshalledRequest,
): TopologyError | ValidationError {
  debugWrite(creature);
  const message = restoreSubstitutedId(
    failure.message,
    failure.neuronIndex,
    marshalled.substitutedIds,
  );
  return failure.class === "TopologyError"
    ? new TopologyError(message, failure.reason as TopologyErrorReason)
    : new ValidationError(message, failure.reason as ValidationErrorName);
}

/**
 * The checks that cannot move to Rust (Issue #3802).
 *
 * Every check here reads state that only exists inside the JavaScript heap, so
 * none of it can cross a WASM boundary — a Rust validator receives serialised
 * creature data and has no way to observe any of it:
 *
 * - `neuron.validate()` delegates to {@link Neuron}'s own validation of its
 *   squash and the `squashMethodCache` it lazily builds. `creatureValidate`
 *   calls it for `hidden` and `output` neurons only; `input` and `constant`
 *   neurons are covered by the rule half instead.
 * - `neuron.index` is an in-memory cache of the neuron's position in
 *   `creature.neurons`. It is never serialised, so there is nothing for a
 *   portable check to compare against.
 * - `neuron.creature` is pointer identity between the neuron and its owning
 *   creature. Object identity has no language-neutral equivalent at all —
 *   `test/fixtures/validate/coverage.json` records this site as
 *   `not-expressible` for exactly that reason.
 *
 * Called once per neuron, in place of that neuron's rule checks having failed;
 * see the throw-ordering contract in the module comment above. The order of
 * the three checks below is itself observable and must not be rearranged.
 */
function hostOnlyNeuronChecks(
  creature: Creature,
  neuron: Neuron,
  indx: number,
): void {
  if (neuron.type === "hidden" || neuron.type === "output") {
    neuron.validate();
  }

  if (neuron.index !== indx) {
    throw new ValidationError(
      `${neuron.ID()}) node.index: ${neuron.index} does not match expected index ${indx}`,
      "OTHER",
    );
  }

  if (neuron.creature !== creature) {
    throw new TopologyError(
      `node ${neuron.ID()} creature mismatch`,
      "INVALID_STATE",
    );
  }
}

function debugWrite(creature: Creature) {
  if (creature.DEBUG) {
    const diagnosticsDir = getDiagnosticsDir();
    Deno.mkdirSync(diagnosticsDir, { recursive: true });
    try {
      creature.DEBUG = false;
      let payload: unknown;
      try {
        payload = creature.exportJSON();
      } catch (exportErr) {
        // Invalid or partially corrupted creatures may not serialise; do not
        // mask the original ValidationError from creatureValidate().
        payload = {
          exportFailed: true,
          name: exportErr instanceof Error ? exportErr.name : "Error",
          message: String(exportErr),
        };
      }
      Deno.writeTextFileSync(
        `${diagnosticsDir}/creatureValidate.json`,
        JSON.stringify(payload, null, 1),
      );
    } finally {
      creature.DEBUG = true;
    }
  }
}
