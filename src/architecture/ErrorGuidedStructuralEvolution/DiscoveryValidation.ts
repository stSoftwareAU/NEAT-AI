/**
 * Validation and issue recording for discovery operations.
 *
 * Validates creatures after structural modifications and records
 * validation failures to disk for later debugging.
 */

import type { Creature } from "../../Creature.ts";
import { ensureDirSync } from "@std/fs";
import { join } from "@std/path";
import { getLogger } from "../../utils/Logger.ts";

/**
 * Validates a creature and attempts to fix it if validation fails.
 * If validation fails and discoveryFailureCacheDir is specified, records the issue
 * to an "issues" subdirectory for later debugging.
 *
 * @param creature - The creature to validate (modified in place if fix is needed).
 * @param originalCreature - The original creature before modifications.
 * @param discoveryID - Unique identifier for the discovery process.
 * @param operationType - Type of operation (e.g., "add-synapses", "remove-neuron").
 * @param candidate - The discovery candidate that caused the modification.
 * @param discoveryFailureCacheDir - Optional directory to log validation issues.
 * @returns Result indicating success/failure and whether fix was called.
 */
export function validateAndFixIfNeeded(
  creature: Creature,
  originalCreature: Creature,
  discoveryID: string,
  operationType: string,
  candidate: unknown,
  discoveryFailureCacheDir?: string,
): { success: boolean; fixWasCalled: boolean; validationError?: Error } {
  const enforceForwardOnly = originalCreature.forwardOnly === true;

  // First attempt validation
  try {
    if (enforceForwardOnly) {
      creature.validate({ forwardOnly: true });
      creature.forwardOnly = true;
    } else {
      creature.validate();
    }
    return { success: true, fixWasCalled: false };
  } catch (validationError) {
    const error = validationError as Error;

    // Log the validation issue if discoveryFailureCacheDir is specified
    if (discoveryFailureCacheDir) {
      recordValidationIssue(
        creature,
        originalCreature,
        discoveryID,
        operationType,
        candidate,
        error,
        discoveryFailureCacheDir,
      );
    }

    getLogger().warn(
      `[Discovery ${discoveryID}] Creature became invalid after ${operationType}: ${error.name} - ${error.message}. ` +
        `This is a bug that should be investigated. Attempting fix() as last resort.`,
    );

    // Attempt to fix the creature.
    // If the original creature is forward-only, ensure we repair by removing recurrent connections.
    if (enforceForwardOnly) {
      creature.fix({ forwardOnly: true });
    } else {
      creature.fix();
    }

    // Re-validate after fix
    try {
      if (enforceForwardOnly) {
        creature.validate({ forwardOnly: true });
        creature.forwardOnly = true;
      } else {
        creature.validate();
      }
      return { success: true, fixWasCalled: true, validationError: error };
    } catch (fixError) {
      getLogger().error(
        `[Discovery ${discoveryID}] fix() failed to repair creature after ${operationType}. Error: ${fixError}`,
      );
      return { success: false, fixWasCalled: true, validationError: error };
    }
  }
}

/**
 * Records a validation issue to the issues subdirectory for debugging.
 * Creates a unique directory containing all information needed to reproduce the issue.
 */
function recordValidationIssue(
  invalidCreature: Creature,
  originalCreature: Creature,
  discoveryID: string,
  operationType: string,
  candidate: unknown,
  error: Error,
  discoveryFailureCacheDir: string,
): void {
  try {
    // Create timestamp in Australian format (yyyymmdd-HHmmss)
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .slice(0, 15);

    // Create unique directory for this issue
    const issueDir = join(
      discoveryFailureCacheDir,
      "issues",
      `${timestamp}-${discoveryID}-${operationType}`,
    );
    ensureDirSync(issueDir);

    // Save the candidate
    const candidatePath = join(issueDir, "candidate.json");
    Deno.writeTextFileSync(
      candidatePath,
      JSON.stringify(candidate, null, 2),
    );

    // Save the original creature
    const originalPath = join(issueDir, "original-creature.json");
    Deno.writeTextFileSync(
      originalPath,
      JSON.stringify(originalCreature.exportJSON(), null, 2),
    );

    // Save the invalid creature (before fix)
    const invalidPath = join(issueDir, "invalid-creature.json");
    Deno.writeTextFileSync(
      invalidPath,
      JSON.stringify(invalidCreature.exportJSON(), null, 2),
    );

    // Save the error details
    const errorPath = join(issueDir, "error.txt");
    const errorContent = [
      `Validation Error Report`,
      `=======================`,
      ``,
      `Timestamp: ${now.toISOString()}`,
      `Discovery ID: ${discoveryID}`,
      `Operation Type: ${operationType}`,
      ``,
      `Error Name: ${error.name}`,
      `Error Message: ${error.message}`,
      ``,
      `Stack Trace:`,
      error.stack ?? "No stack trace available",
    ].join("\n");
    Deno.writeTextFileSync(errorPath, errorContent);

    getLogger().warn(
      `[Discovery ${discoveryID}] Validation issue recorded to: ${issueDir}`,
    );
  } catch (recordError) {
    // Don't let recording failure prevent the main flow
    getLogger().error(
      `[Discovery ${discoveryID}] Failed to record validation issue: ${recordError}`,
    );
  }
}

/**
 * Records a discovery issue to the issues subdirectory for debugging.
 *
 * This is used for cases where the creature may still validate, but the discovery
 * candidate is logically broken for our forward-pass evaluation ordering (eg,
 * a candidate proposes a from -> to link where the "from" neuron is after the
 * target neuron in the evaluation order, making the new neuron's activation
 * effectively zero at that stage).
 */
export function recordDiscoveryIssue(
  originalCreature: Creature,
  discoveryID: string,
  operationType: string,
  issueType: string,
  details: unknown,
  discoveryFailureCacheDir: string,
): void {
  try {
    // Create timestamp in Australian format (yyyymmdd-HHmmss)
    const now = new Date();
    const timestamp = now.toISOString()
      .replace(/[-:]/g, "")
      .replace("T", "-")
      .slice(0, 15);

    const issueDir = join(
      discoveryFailureCacheDir,
      "issues",
      `${timestamp}-${discoveryID}-${operationType}-${issueType}`,
    );
    ensureDirSync(issueDir);

    const detailsPath = join(issueDir, "candidate.json");
    Deno.writeTextFileSync(detailsPath, JSON.stringify(details, null, 2));

    const originalPath = join(issueDir, "original-creature.json");
    Deno.writeTextFileSync(
      originalPath,
      JSON.stringify(originalCreature.exportJSON(), null, 2),
    );

    const errorPath = join(issueDir, "error.txt");
    const detailsRecord = details as Record<string, unknown> | null;
    const message =
      detailsRecord && typeof detailsRecord["message"] === "string"
        ? detailsRecord["message"]
        : undefined;
    const fromIndex =
      detailsRecord && typeof detailsRecord["fromIndex"] === "number"
        ? detailsRecord["fromIndex"]
        : undefined;
    const targetIndex = detailsRecord &&
        typeof detailsRecord["targetIndex"] === "number"
      ? detailsRecord["targetIndex"]
      : undefined;
    const errorContent = [
      `Discovery Issue Report`,
      `======================`,
      ``,
      `Timestamp: ${now.toISOString()}`,
      `Discovery ID: ${discoveryID}`,
      `Operation Type: ${operationType}`,
      `Issue Type: ${issueType}`,
      ``,
      `Summary: Candidate is incompatible with forward-pass evaluation ordering.`,
      message ? `Message: ${message}` : undefined,
      fromIndex !== undefined ? `fromIndex: ${fromIndex}` : undefined,
      targetIndex !== undefined ? `targetIndex: ${targetIndex}` : undefined,
    ].filter((line) => line !== undefined).join("\n");
    Deno.writeTextFileSync(errorPath, errorContent);

    getLogger().warn(
      `[Discovery ${discoveryID}] Discovery issue recorded to: ${issueDir}`,
    );
  } catch (recordError) {
    // Don't let recording failure prevent the main flow
    getLogger().error(
      `[Discovery ${discoveryID}] Failed to record discovery issue: ${recordError}`,
    );
  }
}
