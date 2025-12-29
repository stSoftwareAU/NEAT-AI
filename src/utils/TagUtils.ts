import type { TagInterface } from "@stsoftware/tags/mod";

/**
 * De-duplicate tags by value equality, not reference equality.
 *
 * Note (29-Dec-2025): `Set<TagInterface>` de-duplicates by reference, so two
 * distinct objects with identical `{name, value}` content would both be kept.
 * This helper de-duplicates by `{name, value}` so merged synapses don't
 * accumulate duplicate metadata tags.
 */
export function dedupeTagsByNameValue(
  tags: TagInterface[] | undefined,
): TagInterface[] | undefined {
  if (!tags || tags.length === 0) return undefined;

  const seen = new Set<string>();
  const out: TagInterface[] = [];

  for (const tag of tags) {
    // TagInterface is expected to be `{ name, value }`. We build a stable key
    // and treat identical (name,value) pairs as duplicates.
    const key = `${tag.name}\u0000${String(tag.value)}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(tag);
  }

  return out.length ? out : undefined;
}

/**
 * Merge two tag arrays and de-duplicate by `{name, value}`.
 */
export function mergeTagsByNameValue(
  a: TagInterface[] | undefined,
  b: TagInterface[] | undefined,
): TagInterface[] | undefined {
  if (!a?.length) return dedupeTagsByNameValue(b);
  if (!b?.length) return dedupeTagsByNameValue(a);
  return dedupeTagsByNameValue([...a, ...b]);
}
