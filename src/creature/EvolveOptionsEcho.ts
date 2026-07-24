/**
 * Echo of the caller-supplied evolve options recorded on the run-level result
 * (Issue #3422, revised by Issue #3427).
 *
 * Only the options the calling program actually requested are echoed — the raw
 * options object passed to `evolveDir`/`evolveDataSet`/`evolveEnv`/`evolveRL`,
 * i.e. the changes from defaults. The fully-resolved config is deliberately not
 * recorded because the defaults can be inferred downstream; capturing just the
 * request keeps the persisted `result.json` small and shows exactly which knobs
 * a run turned.
 *
 * Options are serialised as passed. Entries whose value cannot round-trip
 * through JSON — function/callback options (e.g. `onTrainingEvent`,
 * `customCost`, `logger`) and anything else non-serialisable (e.g. an
 * `AbortSignal`) — are dropped entirely rather than recorded with a marker
 * (Issue #3427): such markers carry no tuning value and are pure noise.
 *
 * The one exception is `creatures`, the seed-creature array. It never
 * round-trips cleanly, but its size can matter when comparing runs, so instead
 * of dropping it the echo records the seed-creature **count** as a number
 * (e.g. `"creatures": 12`). An empty seed array echoes as `0`; when the caller
 * supplies no `creatures` option at all, nothing is echoed.
 */

/** Option name whose value is echoed as a seed-creature count, not the array. */
const CREATURES_OPTION = "creatures";

/** JSON-safe echo of the caller-requested options, keyed by option name. */
export type OptionsEcho = Record<string, unknown>;

/**
 * Serialise the caller-supplied options object into a JSON-safe
 * {@link OptionsEcho}. Only the caller's own enumerable keys are echoed;
 * `undefined` values are skipped, the `creatures` seed array is echoed as its
 * count, and any other value that cannot round-trip through JSON (functions,
 * non-serialisable values) is dropped entirely — no marker is recorded.
 */
export function serialiseOptionsEcho(
  options: object | undefined,
): OptionsEcho {
  const echo: OptionsEcho = {};
  if (options === undefined || options === null) return echo;

  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;

    // Seed creatures never round-trip cleanly; record the count instead of the
    // (unserialisable) array so seed size stays comparable between runs.
    if (key === CREATURES_OPTION && Array.isArray(value)) {
      echo[key] = value.length;
      continue;
    }

    // Functions/callbacks cannot serialise — drop them, no marker.
    if (typeof value === "function") continue;

    try {
      const json = JSON.stringify(value);
      // JSON.stringify returns undefined for values with no JSON
      // representation (e.g. a bare symbol); drop those too.
      if (json === undefined) continue;
      echo[key] = JSON.parse(json);
    } catch {
      // Circular reference or a value whose toJSON throws — drop it.
      continue;
    }
  }
  return echo;
}
