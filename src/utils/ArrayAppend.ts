/**
 * Stack-safe in-place array append (Issue #2897).
 *
 * Appends every element of `items` onto the end of `target`, mutating `target`
 * and preserving both the existing `target` contents and the order of `items`.
 *
 * ## Why not `target.push(...items)`?
 * Spreading an array into function arguments places one argument per element on
 * the call stack. For an unbounded array this exceeds the V8 argument/stack
 * limit (~65k–130k elements depending on stack depth) and throws
 * `RangeError: Maximum call stack size exceeded`. The same limit applies to
 * `Array.prototype.push.apply(target, items)`, so that is no safer.
 *
 * `concat` avoids the stack limit but allocates a *new* array; the crash site
 * (`NeatEvolution.ts`) holds `newPopulation` as a `const` that is aliased and
 * mutated later, so the append must be in place. A plain indexed loop appends
 * in place with no per-element argument on the stack, so it scales to any size.
 *
 * @param target The array to append onto, mutated in place.
 * @param items  The elements to append, in order. An empty list is a no-op.
 */
export function appendAll<T>(target: T[], items: readonly T[]): void {
  for (let i = 0; i < items.length; i++) {
    target.push(items[i]);
  }
}
