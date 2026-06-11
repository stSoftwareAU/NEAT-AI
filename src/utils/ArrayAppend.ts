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

/**
 * Stack-safe in-place array insertion (Issue #2900).
 *
 * Inserts every element of `items` into `target` at position `index`, mutating
 * `target` in place. Behaviour is identical to
 * `target.splice(index, 0, ...items)` — same resulting order and contents — but
 * without spreading `items` into call arguments.
 *
 * ## Why not `target.splice(index, 0, ...items)`?
 * `splice` takes the inserted elements as individual arguments, so spreading an
 * unbounded `items` array places one argument per element on the call stack and
 * throws `RangeError: Maximum call stack size exceeded` past V8's limit — the
 * same failure mode as `push(...items)`. This helper detaches the tail, appends
 * `items` with an indexed loop, then re-appends the tail, so it scales to any
 * size while keeping the same `target` array object (callers that alias
 * `target` keep their reference).
 *
 * @param target The array to insert into, mutated in place.
 * @param index  The position at which to insert; clamped to `[0, target.length]`.
 * @param items  The elements to insert, in order. An empty list is a no-op.
 */
export function insertAll<T>(
  target: T[],
  index: number,
  items: readonly T[],
): void {
  if (items.length === 0) return;
  const at = Math.max(0, Math.min(index, target.length));
  const tail = target.slice(at);
  target.length = at;
  for (let i = 0; i < items.length; i++) {
    target.push(items[i]);
  }
  for (let i = 0; i < tail.length; i++) {
    target.push(tail[i]);
  }
}
