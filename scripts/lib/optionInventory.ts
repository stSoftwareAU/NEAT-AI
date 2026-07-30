/**
 * Option-key enumeration for the #3505 option-removal audit (Issue #3518).
 *
 * Keys are derived from the TypeScript source of `src/config/` rather than a
 * hand-maintained list, so the inventory cannot silently drift when a config
 * interface gains or loses a field.
 */

/** One enumerated option key. */
export interface OptionKeyRow {
  /** `top-level` for `NeatArguments`, `nested` for a `*Config.ts` interface. */
  slice: "top-level" | "nested";
  /** Repo-relative file declaring the key. */
  ownerFile: string;
  /** Interface declaring the key. */
  owner: string;
  /** The option key itself. */
  key: string;
}

const IDENT_START = /[A-Za-z_$]/;
const IDENT_PART = /[A-Za-z0-9_$]/;
const OPENERS = "{([";
const CLOSERS = "})]";

/**
 * Blank out comment bodies and string-literal contents, preserving offsets and
 * newlines. Downstream scanning can then treat the result as pure structure.
 */
export function stripCommentsAndStrings(source: string): string {
  const out: string[] = [];
  const blank = (ch: string) => (ch === "\n" ? "\n" : " ");
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];

    if (c === "/" && next === "/") {
      while (i < source.length && source[i] !== "\n") {
        out.push(blank(source[i++]));
      }
      continue;
    }
    if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      while (i < stop) out.push(blank(source[i++]));
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      out.push(c);
      i++;
      while (i < source.length && source[i] !== c) {
        // A backslash escape consumes the next character too, so a `\"` never
        // terminates the literal.
        if (source[i] === "\\") {
          out.push(" ");
          i++;
          if (i < source.length) out.push(blank(source[i++]));
          continue;
        }
        out.push(blank(source[i++]));
      }
      if (i < source.length) out.push(source[i++]);
      continue;
    }
    out.push(c);
    i++;
  }
  return out.join("");
}

/** Names of every `export interface` declared in `source`. */
export function listExportedInterfaces(source: string): string[] {
  const clean = stripCommentsAndStrings(source);
  const names: string[] = [];
  const re = /\bexport\s+interface\s+([A-Za-z0-9_$]+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(clean)) !== null) names.push(m[1]);
  return names;
}

/** Index of the `}` matching the `{` at `open`, or -1 when unbalanced. */
function matchBrace(text: string, open: number): number {
  let depth = 0;
  for (let i = open; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}" && --depth === 0) return i;
  }
  return -1;
}

/**
 * Read an identifier or quoted property name starting at `i`.
 *
 * `body` is the blanked text used for structure; `raw` is the original at the
 * same offsets, so a quoted key such as `"some-key"` keeps its real name.
 */
function readName(
  body: string,
  raw: string,
  i: number,
): { name: string; end: number } | null {
  const quote = body[i];
  if (quote === '"' || quote === "'") {
    const close = body.indexOf(quote, i + 1);
    if (close === -1) return null;
    return { name: raw.slice(i + 1, close), end: close + 1 };
  }
  if (!IDENT_START.test(quote)) return null;
  let end = i + 1;
  while (end < body.length && IDENT_PART.test(body[end])) end++;
  return { name: body.slice(i, end), end };
}

function skipSpace(body: string, i: number): number {
  while (i < body.length && /\s/.test(body[i])) i++;
  return i;
}

/**
 * Property names declared directly in an interface body (depth 0 only, so
 * fields of an inline nested object type are not hoisted to the parent).
 */
function keysFromBody(body: string, raw: string): string[] {
  const keys: string[] = [];
  let depth = 0;
  let i = 0;

  while (i < body.length) {
    const c = body[i];
    if (OPENERS.includes(c)) {
      depth++;
      i++;
      continue;
    }
    if (CLOSERS.includes(c)) {
      depth--;
      i++;
      continue;
    }
    if (depth > 0) {
      i++;
      continue;
    }

    const read = readName(body, raw, i);
    if (!read) {
      i++;
      continue;
    }

    let j = skipSpace(body, read.end);
    if (body[j] === "?") j = skipSpace(body, j + 1);
    if (body[j] !== ":") {
      // A modifier (`readonly`), a method name, or a type token — step past
      // the name only, so the real property name is still seen next.
      i = read.end;
      continue;
    }

    keys.push(read.name);
    // Skip the whole type annotation, so identifiers inside it (e.g. the
    // branches of a conditional type) are never mistaken for property names.
    i = j + 1;
    let typeDepth = 0;
    while (i < body.length) {
      const t = body[i];
      if (OPENERS.includes(t)) typeDepth++;
      else if (CLOSERS.includes(t)) typeDepth--;
      else if (typeDepth === 0 && (t === ";" || t === ",")) break;
      i++;
    }
    i++;
  }
  return keys;
}

/**
 * Property names declared by `interfaceName` in `source`.
 *
 * Throws when the interface is absent or unbalanced — a missing interface means
 * the enumeration is incomplete, and silently returning `[]` is exactly the
 * drift this harness exists to prevent.
 */
export function extractInterfaceKeys(
  source: string,
  interfaceName: string,
): string[] {
  const clean = stripCommentsAndStrings(source);
  // Hardcoded regex over every declaration, then compare the captured name —
  // a dynamic RegExp built from `interfaceName` would risk ReDoS.
  let declIndex = -1;
  for (const m of clean.matchAll(/\binterface\s+([A-Za-z_$][\w$]*)\b/g)) {
    if (m[1] === interfaceName) {
      declIndex = m.index ?? -1;
      break;
    }
  }
  if (declIndex === -1) {
    throw new Error(`interface ${interfaceName} not found in source`);
  }

  const open = clean.indexOf("{", declIndex);
  if (open === -1) throw new Error(`interface ${interfaceName} has no body`);
  const close = matchBrace(clean, open);
  if (close === -1) {
    throw new Error(`interface ${interfaceName} body is unbalanced`);
  }

  return keysFromBody(
    clean.slice(open + 1, close),
    source.slice(open + 1, close),
  );
}

/** Config files whose exported interfaces form the nested-option slice. */
async function nestedConfigFiles(configDir: string): Promise<string[]> {
  const files: string[] = [];
  for await (const entry of Deno.readDir(configDir)) {
    if (entry.isFile && entry.name.endsWith("Config.ts")) {
      files.push(entry.name);
    }
  }
  return files.sort();
}

/**
 * Enumerate every option key: top-level fields of `NeatArguments` plus the
 * fields of every exported interface in `src/config/*Config.ts`.
 */
export async function enumerateOptionKeys(
  rootDir = ".",
): Promise<OptionKeyRow[]> {
  const configDir = `${rootDir}/src/config`;
  const rows: OptionKeyRow[] = [];

  const argsFile = "src/config/NeatArguments.ts";
  const argsSource = await Deno.readTextFile(`${rootDir}/${argsFile}`);
  for (const key of extractInterfaceKeys(argsSource, "NeatArguments")) {
    rows.push({
      slice: "top-level",
      ownerFile: argsFile,
      owner: "NeatArguments",
      key,
    });
  }

  const files = await nestedConfigFiles(configDir);
  const sources = await Promise.all(
    files.map((name) => Deno.readTextFile(`${configDir}/${name}`)),
  );
  files.forEach((name, index) => {
    const source = sources[index];
    for (const owner of listExportedInterfaces(source)) {
      for (const key of extractInterfaceKeys(source, owner)) {
        rows.push({
          slice: "nested",
          ownerFile: `src/config/${name}`,
          owner,
          key,
        });
      }
    }
  });

  return rows;
}

/** Distinct keys across every row, sorted — the search work-list. */
export function uniqueKeys(rows: OptionKeyRow[]): string[] {
  return [...new Set(rows.map((r) => r.key))].sort();
}
