/**
 * Safe file writing utilities that prevent zero-length or corrupted files.
 *
 * These utilities write to a temporary file first, then atomically rename
 * to the final destination. This ensures the target file is never in a
 * partial or corrupted state.
 *
 * @module
 */

import { dirname, join } from "@std/path";
import { ensureDirSync } from "@std/fs";

/**
 * Writes JSON content to a file safely by writing to a temporary file first
 * and then renaming atomically.
 *
 * @param filePath - The target file path
 * @param content - The object to serialise as JSON
 * @param indent - Number of spaces for indentation (default: 1)
 * @throws If the write or rename operation fails
 */
export function safeWriteJsonSync(
  filePath: string,
  content: unknown,
  indent = 1,
): void {
  const jsonContent = JSON.stringify(content, null, indent);
  safeWriteTextSync(filePath, jsonContent);
}

/**
 * Writes text content to a file safely by writing to a temporary file first
 * and then renaming atomically.
 *
 * @param filePath - The target file path
 * @param content - The text content to write
 * @throws If the write or rename operation fails
 */
export function safeWriteTextSync(filePath: string, content: string): void {
  const dir = dirname(filePath);
  ensureDirSync(dir);

  // Generate a unique temporary filename in the same directory
  const tempPath = join(dir, `.tmp-${crypto.randomUUID()}.json`);

  try {
    // Write to temporary file
    Deno.writeTextFileSync(tempPath, content);

    // Atomically rename to target
    Deno.renameSync(tempPath, filePath);
  } catch (error) {
    // Clean up temp file if it exists
    try {
      Deno.removeSync(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}

/**
 * Writes JSON content to a file safely (async version).
 *
 * @param filePath - The target file path
 * @param content - The object to serialise as JSON
 * @param indent - Number of spaces for indentation (default: 1)
 * @throws If the write or rename operation fails
 */
export async function safeWriteJson(
  filePath: string,
  content: unknown,
  indent = 1,
): Promise<void> {
  const jsonContent = JSON.stringify(content, null, indent);
  await safeWriteText(filePath, jsonContent);
}

/**
 * Writes text content to a file safely (async version).
 *
 * @param filePath - The target file path
 * @param content - The text content to write
 * @throws If the write or rename operation fails
 */
export async function safeWriteText(
  filePath: string,
  content: string,
): Promise<void> {
  const dir = dirname(filePath);
  ensureDirSync(dir);

  // Generate a unique temporary filename in the same directory
  const tempPath = join(dir, `.tmp-${crypto.randomUUID()}.json`);

  try {
    // Write to temporary file
    await Deno.writeTextFile(tempPath, content);

    // Atomically rename to target
    await Deno.rename(tempPath, filePath);
  } catch (error) {
    // Clean up temp file if it exists
    try {
      await Deno.remove(tempPath);
    } catch {
      // Ignore cleanup errors
    }
    throw error;
  }
}
