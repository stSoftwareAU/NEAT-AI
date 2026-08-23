/**
 * @module
 *
 * Types and a fail-loud parser for the language-neutral `creatureValidate`
 * conformance corpus (Issue #3801).
 *
 * A corpus file is plain JSON — `JSON.parse` is the only reader — so
 * NEAT-AI-core can vendor the same bytes as a Rust test input. Every shape
 * rule below is checked at load time and reported with the offending file and
 * case name: a malformed case must fail loudly rather than be skipped.
 */

/**
 * A JSON-expressible number. `null` means "field absent" (`undefined` in
 * memory); the string sentinels carry the non-finite values JSON cannot.
 */
export type CorpusNumber = number | "Infinity" | "-Infinity" | "NaN" | null;

/** One neuron, in the runtime (`NeuronInternal`) shape `creatureValidate` reads. */
export interface CorpusNeuron {
  /** Neuron type; deliberately a plain string so unknown types are expressible. */
  readonly type: string;
  /** Runtime integer id. `null` expresses a missing id. */
  readonly id: CorpusNumber;
  /** Stable wire identity, used by the diagnostic labels in error messages. */
  readonly uuid?: string;
  /** Bias. Absent/`null` means `undefined`; inputs default to `Infinity`. */
  readonly bias?: CorpusNumber;
  /** Activation function name. */
  readonly squash?: string;
  /** Position claimed by the neuron; defaults to its array position. */
  readonly index?: number;
}

/** One synapse, in the runtime (`SynapseInternal`) index-based shape. */
export interface CorpusSynapse {
  readonly from: number;
  readonly to: number;
  readonly weight: number;
  readonly type?: "positive" | "negative" | "condition";
}

/** The creature under test, described entirely by plain JSON. */
export interface CorpusCreature {
  readonly input: number;
  readonly output: number;
  readonly forwardOnly?: boolean;
  readonly neurons: CorpusNeuron[];
  readonly synapses: CorpusSynapse[];
  /** Memetic record, passed through verbatim (may be deliberately malformed). */
  readonly memetic?: unknown;
}

/** The `options` argument passed to `creatureValidate`. */
export interface CorpusOptions {
  readonly neurons?: number;
  readonly connections?: number;
  readonly feedbackLoop?: boolean;
  readonly forwardOnly?: boolean;
}

/** The `stats` object returned by a successful `creatureValidate`. */
export interface CorpusStats {
  readonly input: number;
  readonly constant: number;
  readonly hidden: number;
  readonly output: number;
  readonly connections: number;
}

/** The frozen outcome of one case. */
export interface CorpusExpect {
  readonly outcome: "ok" | "throws";
  readonly error?: "ValidationError" | "TopologyError";
  readonly reason?: string;
  readonly messageContains?: string;
  readonly stats?: CorpusStats;
}

/** One conformance case. */
export interface CorpusCase {
  readonly name: string;
  /** Throw-site (or happy-path) identifier declared in `coverage.json`. */
  readonly rule: string;
  /** Free-text commentary — JSON has no comments. */
  readonly notes?: string;
  readonly creature: CorpusCreature;
  readonly options?: CorpusOptions;
  readonly expect: CorpusExpect;
}

/** One corpus file: a named group of cases. */
export interface CorpusFile {
  readonly group: string;
  readonly description?: string;
  readonly cases: CorpusCase[];
}

const NEURON_KEYS = new Set(["type", "id", "uuid", "bias", "squash", "index"]);
const SYNAPSE_KEYS = new Set(["from", "to", "weight", "type"]);
const CREATURE_KEYS = new Set([
  "input",
  "output",
  "forwardOnly",
  "neurons",
  "synapses",
  "memetic",
]);
const OPTION_KEYS = new Set([
  "neurons",
  "connections",
  "feedbackLoop",
  "forwardOnly",
]);
const EXPECT_KEYS = new Set([
  "outcome",
  "error",
  "reason",
  "messageContains",
  "stats",
]);
const STATS_KEYS = new Set([
  "input",
  "constant",
  "hidden",
  "output",
  "connections",
]);
const CASE_KEYS = new Set([
  "name",
  "rule",
  "notes",
  "creature",
  "options",
  "expect",
]);
const SYNAPSE_TYPES = new Set(["positive", "negative", "condition"]);
const NUMBER_SENTINELS = new Set(["Infinity", "-Infinity", "NaN"]);

/** Fails loudly; the corpus is only useful when every case is well formed. */
function corpusFail(where: string, message: string): never {
  throw new Error(`Conformance corpus ${where}: ${message}`);
}

function asRecord(value: unknown, where: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    corpusFail(where, `expected an object, got ${JSON.stringify(value)}`);
  }
  return value as Record<string, unknown>;
}

function assertKnownKeys(
  record: Record<string, unknown>,
  allowed: Set<string>,
  where: string,
): void {
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) corpusFail(where, `unknown key '${key}'`);
  }
}

function requireString(
  record: Record<string, unknown>,
  key: string,
  where: string,
): string {
  const value = record[key];
  if (typeof value !== "string" || value.length === 0) {
    corpusFail(where, `'${key}' must be a non-empty string`);
  }
  return value;
}

function optionalString(
  record: Record<string, unknown>,
  key: string,
  where: string,
): string | undefined {
  if (record[key] === undefined) return undefined;
  return requireString(record, key, where);
}

function requireNumber(
  record: Record<string, unknown>,
  key: string,
  where: string,
): number {
  const value = record[key];
  if (typeof value !== "number") {
    corpusFail(where, `'${key}' must be a number`);
  }
  return value;
}

function optionalNumber(
  record: Record<string, unknown>,
  key: string,
  where: string,
): number | undefined {
  if (record[key] === undefined) return undefined;
  return requireNumber(record, key, where);
}

function optionalBoolean(
  record: Record<string, unknown>,
  key: string,
  where: string,
): boolean | undefined {
  const value = record[key];
  if (value === undefined) return undefined;
  if (typeof value !== "boolean") corpusFail(where, `'${key}' must be boolean`);
  return value;
}

/** A number, a non-finite sentinel string, or `null` for "absent". */
function corpusNumber(
  record: Record<string, unknown>,
  key: string,
  where: string,
  required: boolean,
): CorpusNumber {
  const value = record[key];
  if (value === undefined) {
    if (required) corpusFail(where, `'${key}' is required (use null for none)`);
    return null;
  }
  if (value === null || typeof value === "number") return value;
  if (typeof value === "string" && NUMBER_SENTINELS.has(value)) {
    return value as CorpusNumber;
  }
  corpusFail(
    where,
    `'${key}' must be a number, null, or one of ${
      [...NUMBER_SENTINELS].join(" / ")
    }`,
  );
}

function parseNeuron(value: unknown, where: string): CorpusNeuron {
  const record = asRecord(value, where);
  assertKnownKeys(record, NEURON_KEYS, where);
  return {
    type: requireString(record, "type", where),
    id: corpusNumber(record, "id", where, true),
    uuid: optionalString(record, "uuid", where),
    bias: corpusNumber(record, "bias", where, false),
    squash: optionalString(record, "squash", where),
    index: optionalNumber(record, "index", where),
  };
}

function parseSynapse(value: unknown, where: string): CorpusSynapse {
  const record = asRecord(value, where);
  assertKnownKeys(record, SYNAPSE_KEYS, where);
  const type = optionalString(record, "type", where);
  if (type !== undefined && !SYNAPSE_TYPES.has(type)) {
    corpusFail(where, `unknown synapse type '${type}'`);
  }
  return {
    from: requireNumber(record, "from", where),
    to: requireNumber(record, "to", where),
    weight: requireNumber(record, "weight", where),
    type: type as CorpusSynapse["type"],
  };
}

function parseArray(value: unknown, where: string): unknown[] {
  if (!Array.isArray(value)) corpusFail(where, "expected an array");
  return value;
}

function parseCreature(value: unknown, where: string): CorpusCreature {
  const record = asRecord(value, where);
  assertKnownKeys(record, CREATURE_KEYS, where);
  return {
    input: requireNumber(record, "input", where),
    output: requireNumber(record, "output", where),
    forwardOnly: optionalBoolean(record, "forwardOnly", where),
    neurons: parseArray(record.neurons, `${where} neurons`).map((n, i) =>
      parseNeuron(n, `${where} neuron[${i}]`)
    ),
    synapses: parseArray(record.synapses, `${where} synapses`).map((s, i) =>
      parseSynapse(s, `${where} synapse[${i}]`)
    ),
    memetic: record.memetic,
  };
}

function parseOptions(value: unknown, where: string): CorpusOptions {
  const record = asRecord(value, where);
  assertKnownKeys(record, OPTION_KEYS, where);
  return {
    neurons: optionalNumber(record, "neurons", where),
    connections: optionalNumber(record, "connections", where),
    feedbackLoop: optionalBoolean(record, "feedbackLoop", where),
    forwardOnly: optionalBoolean(record, "forwardOnly", where),
  };
}

function parseStats(value: unknown, where: string): CorpusStats {
  const record = asRecord(value, where);
  assertKnownKeys(record, STATS_KEYS, where);
  return {
    input: requireNumber(record, "input", where),
    constant: requireNumber(record, "constant", where),
    hidden: requireNumber(record, "hidden", where),
    output: requireNumber(record, "output", where),
    connections: requireNumber(record, "connections", where),
  };
}

function parseExpect(value: unknown, where: string): CorpusExpect {
  const record = asRecord(value, where);
  assertKnownKeys(record, EXPECT_KEYS, where);
  const outcome = requireString(record, "outcome", where);
  if (outcome !== "ok" && outcome !== "throws") {
    corpusFail(where, `'outcome' must be 'ok' or 'throws', got '${outcome}'`);
  }
  const error = optionalString(record, "error", where);
  if (outcome === "throws") {
    if (error !== "ValidationError" && error !== "TopologyError") {
      corpusFail(where, "'error' must be ValidationError or TopologyError");
    }
    requireString(record, "reason", where);
    requireString(record, "messageContains", where);
    if (record.stats !== undefined) {
      corpusFail(where, "'stats' is only valid for outcome 'ok'");
    }
  } else {
    if (record.stats === undefined) {
      corpusFail(where, "outcome 'ok' requires 'stats'");
    }
    if (error !== undefined || record.reason !== undefined) {
      corpusFail(where, "'error'/'reason' are only valid for outcome 'throws'");
    }
  }
  return {
    outcome,
    error: error as CorpusExpect["error"],
    reason: optionalString(record, "reason", where),
    messageContains: optionalString(record, "messageContains", where),
    stats: record.stats === undefined
      ? undefined
      : parseStats(record.stats, `${where} stats`),
  };
}

function parseCase(value: unknown, where: string): CorpusCase {
  const record = asRecord(value, where);
  assertKnownKeys(record, CASE_KEYS, where);
  const name = requireString(record, "name", where);
  const at = `${where} '${name}'`;
  return {
    name,
    rule: requireString(record, "rule", at),
    notes: optionalString(record, "notes", at),
    creature: parseCreature(record.creature, `${at} creature`),
    options: record.options === undefined
      ? undefined
      : parseOptions(record.options, `${at} options`),
    expect: parseExpect(record.expect, `${at} expect`),
  };
}

/**
 * Parses one corpus file. `text` must be plain JSON — no `$ref`, no comments,
 * no code-built creatures — so the same bytes drive a Rust runner.
 */
export function parseCorpusFile(text: string, fileName: string): CorpusFile {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    corpusFail(fileName, `is not valid JSON: ${(error as Error).message}`);
  }
  const record = asRecord(raw, fileName);
  assertKnownKeys(record, new Set(["group", "description", "cases"]), fileName);
  const cases = parseArray(record.cases, `${fileName} cases`).map((c, i) =>
    parseCase(c, `${fileName} case[${i}]`)
  );
  if (cases.length === 0) corpusFail(fileName, "contains no cases");
  return {
    group: requireString(record, "group", fileName),
    description: optionalString(record, "description", fileName),
    cases,
  };
}
