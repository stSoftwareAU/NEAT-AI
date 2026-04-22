import type { Creature } from "@creature";
import type { CreatureExport } from "@architecture/CreatureInterfaces.ts";
import { getLogger } from "@utils/Logger.ts";

export const DIAGNOSTICS_DIR = ".diagnostics";

/**
 * Options for writing diagnostic files when an error occurs.
 */
export interface DiagnosticsOptions {
  /** The error that occurred. */
  error: Error | unknown;
  /** Optional prefix for file names (e.g., "breed", "upgrade"). */
  prefix?: string;
  /** Primary creature export (optional). */
  creature?: CreatureExport | string;
  /** Mother creature export for breeding errors (optional). */
  mother?: CreatureExport;
  /** Father creature export for breeding errors (optional). */
  father?: CreatureExport;
  /** Offspring creature export for breeding errors (optional). */
  offspring?: CreatureExport;
  /** Additional context data to include (optional). */
  context?: Record<string, unknown>;
}

/**
 * Writes diagnostic files for debugging errors.
 *
 * This utility centralises the pattern of writing error information and
 * creature state to disk when an invariant is violated. It follows the
 * DRY principle by providing a single implementation used across the
 * codebase.
 *
 * Files are written to `.diagnostics/` with an optional prefix.
 *
 * @param options - The diagnostic options containing error and creature data.
 */
export function writeDiagnostics(options: DiagnosticsOptions): void {
  const {
    error,
    prefix,
    creature,
    mother,
    father,
    offspring,
    context,
  } = options;

  try {
    Deno.mkdirSync(DIAGNOSTICS_DIR, { recursive: true });
  } catch {
    // Directory may already exist; ignore errors.
  }

  const filePrefix = prefix ? `${prefix}-` : "";
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");

  // Write error text
  const errorText = error instanceof Error
    ? `${error.name}: ${error.message}\n\nStack:\n${error.stack ?? "N/A"}`
    : `Error: ${String(error)}`;
  Deno.writeTextFileSync(
    `${DIAGNOSTICS_DIR}/${filePrefix}error-${timestamp}.txt`,
    errorText,
  );

  // Write creature JSON(s)
  if (creature) {
    const creatureJson = typeof creature === "string"
      ? creature
      : JSON.stringify(creature, null, 2);
    Deno.writeTextFileSync(
      `${DIAGNOSTICS_DIR}/${filePrefix}creature-${timestamp}.json`,
      creatureJson,
    );
  }

  if (mother) {
    Deno.writeTextFileSync(
      `${DIAGNOSTICS_DIR}/${filePrefix}mother-${timestamp}.json`,
      JSON.stringify(mother, null, 2),
    );
  }

  if (father) {
    Deno.writeTextFileSync(
      `${DIAGNOSTICS_DIR}/${filePrefix}father-${timestamp}.json`,
      JSON.stringify(father, null, 2),
    );
  }

  if (offspring) {
    Deno.writeTextFileSync(
      `${DIAGNOSTICS_DIR}/${filePrefix}offspring-${timestamp}.json`,
      JSON.stringify(offspring, null, 2),
    );
  }

  // Write context if provided
  if (context) {
    Deno.writeTextFileSync(
      `${DIAGNOSTICS_DIR}/${filePrefix}context-${timestamp}.json`,
      JSON.stringify(context, null, 2),
    );
  }
}

/**
 * Validates a creature after a pipeline operation (breed/mutate/compact/discovery).
 *
 * On the happy path (valid creature) this is a fast structural check.
 * If validation fails, this is treated as a **bug** in our code — the creature
 * and error are dumped to `.diagnostics/` so the root cause can be fixed,
 * and `fix()` is called as a last resort to avoid a hard crash.
 *
 * The 🚨 emoji in the log line is detected by ../GRQ-health as an error.
 * Reserve 🚨 for genuine errors like this one (corruption, validation
 * failure). Non-fatal warnings — e.g. clamping overflowing weights — use
 * the 🗜️ clamp emoji instead so they do not trip the error monitor
 * (Issue #2392).
 *
 * @param creature - The creature to validate
 * @param operation - Which pipeline stage produced this creature (e.g. "breed", "mutate")
 * @param options - Optional validate options (e.g. `{ forwardOnly: true }`)
 */
export function validateOrDiagnose(
  creature: Creature,
  operation: string,
  options?: { forwardOnly?: boolean },
): void {
  try {
    creature.validate(options);
  } catch (error) {
    let creatureExport: CreatureExport | string;
    try {
      creature.DEBUG = false;
      creatureExport = creature.exportJSON();
    } catch {
      creatureExport = "(export failed — creature too corrupted to serialise)";
    }

    const errorMsg = error instanceof Error
      ? `${error.name}: ${error.message}`
      : String(error);

    getLogger().error(
      `🚨 [${operation}] CRITICAL: creature failed validation after ${operation}. ` +
        `${errorMsg}. ` +
        `This is a bug in our code that must be fixed (not the creature).`,
    );

    writeDiagnostics({
      error,
      prefix: operation,
      creature: creatureExport,
      context: {
        operation,
        forwardOnly: creature.forwardOnly,
        uuid: creature.uuid,
        semanticVersion: creature.semanticVersion,
        neuronCount: creature.neurons?.length,
        synapseCount: creature.synapses?.length,
      },
    });

    if (options?.forwardOnly) {
      creature.fix({ forwardOnly: true });
    } else {
      creature.fix();
    }

    try {
      creature.validate(options);
    } catch (fixError) {
      getLogger().error(
        `🚨 [${operation}] fix() failed to repair creature. ` +
          `Error: ${fixError}. The creature is unrecoverable.`,
      );
      throw fixError;
    }
  }
}
