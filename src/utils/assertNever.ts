/**
 * Exhaustiveness guard for discriminated-union `switch` statements.
 *
 * Place `return assertNever(x)` (or `assertNever(x)`) in the `default` branch
 * of a `switch` over a union discriminant. The compiler narrows the value to
 * `never` only when every variant is handled; if a new variant is added and a
 * call site forgets to handle it, the value is no longer `never` and the
 * compile fails at that site — turning a latent runtime data-loss bug into a
 * compile-time error.
 *
 * At runtime (e.g. malformed wire data that escaped the type system) it throws
 * with the offending value so the failure is loud rather than silent.
 */
export function assertNever(x: never): never {
  throw new Error(`Unhandled variant: ${JSON.stringify(x)}`);
}
