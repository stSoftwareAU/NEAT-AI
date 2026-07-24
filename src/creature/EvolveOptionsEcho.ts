/**
 * Echo of the caller-supplied evolve options recorded on the run-level result
 * (Issue #3422).
 *
 * Only the options the calling program actually requested are echoed — the raw
 * options object passed to `evolveDir`/`evolveDataSet`/`evolveEnv`/`evolveRL`,
 * i.e. the changes from defaults. The fully-resolved config is deliberately not
 * recorded because the defaults can be inferred downstream; capturing just the
 * request keeps the persisted `result.json` small and shows exactly which knobs
 * a run turned.
 *
 * Options are serialised as passed. Non-serialisable entries are recorded by
 * name with a marker instead of being silently dropped: function/callback
 * options (e.g. `onTrainingEvent`, `customCost`, `logger`) become
 * `"[function]"` and anything that cannot round-trip through JSON (e.g. an
 * `AbortSignal`) becomes `"[unserialisable]"`. Recording the key with a marker
 * keeps the echo honest about what the caller requested without persisting an
 * unusable value.
 */

/** Marker recorded for a function/callback-valued option. */
export const OPTION_FUNCTION_MARKER = "[function]";
/** Marker recorded for an option that cannot round-trip through JSON. */
export const OPTION_UNSERIALISABLE_MARKER = "[unserialisable]";

/** JSON-safe echo of the caller-requested options, keyed by option name. */
export type OptionsEcho = Record<string, unknown>;

/**
 * Serialise the caller-supplied options object into a JSON-safe
 * {@link OptionsEcho}. Only the caller's own enumerable keys are echoed;
 * `undefined` values are skipped, functions become {@link OPTION_FUNCTION_MARKER},
 * and non-serialisable values become {@link OPTION_UNSERIALISABLE_MARKER}.
 */
export function serialiseOptionsEcho(
  options: object | undefined,
): OptionsEcho {
  const echo: OptionsEcho = {};
  if (options === undefined || options === null) return echo;

  for (const [key, value] of Object.entries(options)) {
    if (value === undefined) continue;
    if (typeof value === "function") {
      echo[key] = OPTION_FUNCTION_MARKER;
      continue;
    }
    try {
      const json = JSON.stringify(value);
      // JSON.stringify returns undefined for values with no JSON
      // representation (e.g. a bare symbol); treat that as unserialisable.
      echo[key] = json === undefined
        ? OPTION_UNSERIALISABLE_MARKER
        : JSON.parse(json);
    } catch {
      // Circular reference or a value whose toJSON throws.
      echo[key] = OPTION_UNSERIALISABLE_MARKER;
    }
  }
  return echo;
}
