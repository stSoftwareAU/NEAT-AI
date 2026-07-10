# ⚠️ Errors and validation

Typed errors thrown by NEAT-AI's public API (Application Programming Interface),
and the validation patterns the library expects callers to follow.

> **Acronyms:** API (Application Programming Interface), CRISPR (Clustered
> Regularly Interspaced Short Palindromic Repeats), DNA (Deoxyribonucleic Acid),
> JSON (JavaScript Object Notation).

## 📦 Exports documented here

- `CrisprError`, `CrisprErrorCode`
- `BreedExhaustionError`, `BreedExhaustionReason`
- `ValidationError` (internal — thrown by creature validation but not
  re-exported from `mod.ts`; documented here so callers know what to catch)

## 🧬 CrisprError

```typescript
import { CrisprError } from "@stsoftware/neat-ai";
import type { CrisprErrorCode } from "@stsoftware/neat-ai";

try {
  validateDNA(dna);
} catch (err) {
  if (err instanceof CrisprError) {
    console.error(err.code, err.message);
  }
}
```

`CrisprError.code` is one of the `CrisprErrorCode` values (e.g.
`"INVALID_DNA"`). Thrown by `validateDNA()` and by the internal CRISPR
(Clustered Regularly Interspaced Short Palindromic Repeats) cleavage pipeline.

## 🍼 BreedExhaustionError

```typescript
import { BreedExhaustionError } from "@stsoftware/neat-ai";
import type { BreedExhaustionReason } from "@stsoftware/neat-ai";
```

Thrown by the breeding pipeline when no viable child can be produced after the
configured retry budget. `BreedExhaustionReason` enumerates the underlying
causes (e.g. all candidate parents excluded, every attempted topology rejected
by validation).

## 🔒 ValidationError

`ValidationError` is **not** re-exported from `mod.ts`, but
`Creature.fromJSON(..., true)` and other validation paths throw it. Its shape is
documented here so callers can `catch` it without importing internal modules.

```typescript
type ValidationErrorName =
  | "OTHER"
  | "NEURON_ORDER" // Constant/hidden neurons out of topological order
  | "NO_OUTWARD_CONNECTIONS" // Neuron has no outgoing synapses
  | "NO_INWARD_CONNECTIONS" // Neuron has no incoming synapses
  | "IF_CONDITIONS" // IF neuron validation failed
  | "RECURSIVE_SYNAPSE" // Backward connection in forward-only mode
  | "SELF_CONNECTION" // Self-loop in forward-only mode
  | "DUPLICATE_SYNAPSE" // Repeated synapse between the same endpoints
  | "MEMETIC"; // Memetic (origin) tracking error

class ValidationError extends Error {
  // `name` is always the fixed literal "ValidationError".
  override readonly name = "ValidationError";
  // The failure code lives here — branch on `reason`, not `name`.
  readonly reason: ValidationErrorName;
  constructor(message: string, reason: ValidationErrorName);
}
```

> [!IMPORTANT]
> `ValidationError.name` is **always** the literal string `"ValidationError"`,
> not the failure code. The discriminant is the separate `reason` field. Branch
> on `error.reason === "RECURSIVE_SYNAPSE"` (guarded by an
> `error.name === "ValidationError"` check or an `instanceof` test). Matching a
> failure code against `error.name` (e.g. `error.name === "<REASON>"`) can
> **never** be true and silently lets the error escape unhandled.

> [!WARNING]
> Always pass `validate: true` to `Creature.fromJSON()` when loading untrusted
> or user-supplied creature data. Skipping validation may result in silent
> failures or corrupt network behaviour during evolution.

## 🛡️ Error handling patterns

```typescript
import { Creature } from "@stsoftware/neat-ai";

try {
  const creature = Creature.fromJSON(jsonData, true); // validate = true
} catch (error) {
  // ValidationError is not re-exported — match by name + shape. The failure
  // code lives in `reason`; `name` is always the literal "ValidationError".
  if (
    error instanceof Error &&
    error.name === "ValidationError" &&
    (error as { reason?: string }).reason === "RECURSIVE_SYNAPSE"
  ) {
    console.error("Network has backward connections in forward-only mode");
  }
  throw error;
}
```

For programmatic discrimination of CRISPR and breeding failures, prefer
`instanceof CrisprError` and `instanceof BreedExhaustionError` respectively —
both classes are stable public exports.

---

## 🔗 Related topics

- [Creature](CREATURE.md) — `Creature.fromJSON()`, the main caller of
  validation.
- [Evolution API](EVOLUTION.md) — breeding paths that throw
  `BreedExhaustionError`.
- [`docs/CRISPR_GUIDE.md`](../CRISPR_GUIDE.md) — DNA conventions whose
  violations surface as `CrisprError`.
- [`docs/TROUBLESHOOTING.md`](../TROUBLESHOOTING.md) — common error signatures
  and remediation.

---

**Up to:** [`README.md`](../../README.md) (entry point) ·
[`docs/README.md`](../README.md) (topic index).
