/**
 * ReleasableRef.ts - Typed helpers for releasing object references to aid
 * V8 garbage collection (Issue #2398).
 *
 * Replaces the scattered GC-cleanup `ts-ignore` directive pattern that
 * previously suppressed type information when assigning `null` to
 * non-nullable properties. The pattern appeared in long-running
 * worker/discovery code paths where holding onto large payloads
 * (creatures, traces, discovery results) after they had been cloned or
 * serialised would needlessly grow the heap.
 *
 * Centralising the escape hatch here means:
 *   - the intent ("release this field for GC") is expressed at the call
 *     site as a named function, not an unsafe directive;
 *   - refactors can change the implementation (e.g. swap `null` for
 *     `undefined`, or add logging) in one place;
 *   - a regression test can enforce that no new GC-cleanup `ts-ignore`
 *     directives are introduced.
 */

/**
 * A key accepted by the helpers below.
 *
 * Autocomplete surfaces the declared public keys of `T` (the typical case
 * for plain data objects like `RequestData.evaluate`), while still
 * accepting any `string` — this is required when the host is `this`
 * inside a class method, because TypeScript's polymorphic `this` type
 * does not expose protected/private fields via `keyof this`.
 *
 * The `(string & {})` intersection is the idiomatic TypeScript trick to
 * widen a literal key union to `string` without losing autocomplete.
 */
// deno-lint-ignore ban-types
type ReleasableKey<T> = keyof T | (string & {});

/**
 * Clears a property on `host` for garbage-collection purposes.
 *
 * The property is assigned `null` regardless of its declared type — this
 * is deliberate. Call sites typically hold large payload objects whose
 * fields are typed as non-nullable for safety elsewhere, but must be
 * released once the payload has been cloned across a worker boundary or
 * its subordinate data has been consumed.
 *
 * Uses `Reflect.set` rather than a `Record`/`any` cast so the helper
 * itself remains fully typed — no `any` leaks through. Autocomplete
 * works against the public keys of `T`; additionally, any string is
 * accepted so the helper works on class `this` (whose polymorphic
 * `keyof this` does not expose protected/private fields).
 *
 * @typeParam T - The host object type (must be an object).
 * @param host - The object owning the reference.
 * @param key - The property name to release.
 */
export function clearForGc<T extends object>(
  host: T,
  key: ReleasableKey<T>,
): void {
  Reflect.set(host, key as PropertyKey, null);
}

/**
 * Returns `true` if `host[key]` has been released (i.e. the runtime
 * value is `null`), `false` otherwise.
 *
 * Companion to {@link clearForGc}. Because `clearForGc` assigns `null`
 * to a property typed as non-nullable, consumers that need to check
 * whether the reference has already been released cannot rely on
 * TypeScript's narrowing — this helper performs a typed runtime check
 * without a `@ts-ignore` at the call site.
 */
export function isReleased<T extends object>(
  host: T,
  key: ReleasableKey<T>,
): boolean {
  return Reflect.get(host, key as PropertyKey) === null;
}
