/**
 * Streaming Creature I/O Module
 *
 * Issue #1296: Performance: Streaming JSON parsing for creature serialisation
 *
 * Provides streaming serialisation and deserialisation for creatures to reduce
 * memory pressure and improve I/O performance for large creatures (600+ neurons).
 *
 * Key features:
 * - Incremental JSON output via generator functions
 * - Chunked reading for memory-efficient parsing
 * - File-based streaming operations for cache read/write
 * - Sync and async variants for different use cases
 *
 * @module StreamingCreatureIO
 */

import type { CreatureExport } from "./CreatureInterfaces.ts";
import { Creature } from "../Creature.ts";

/**
 * Creates an async generator that yields JSON chunks for a creature export.
 * This allows writing large creatures to file without building the full JSON string in memory.
 *
 * @param creature - The creature to serialise
 * @param indent - Number of spaces for indentation (default: 1 for compatibility with existing format)
 * @yields JSON string chunks that when concatenated form valid JSON
 */
export async function* createStreamingCreatureWriter(
  creature: Creature,
  indent: number = 1,
): AsyncGenerator<string> {
  const exported = creature.exportJSON();
  const space = " ".repeat(indent);

  yield "{\n";

  // Write metadata fields
  yield `${space}"semanticVersion": ${
    JSON.stringify(exported.semanticVersion)
  }`;

  if (exported.forwardOnly !== undefined) {
    yield `,\n${space}"forwardOnly": ${exported.forwardOnly}`;
  }

  // Write input/output counts
  yield `,\n${space}"input": ${exported.input}`;
  yield `,\n${space}"output": ${exported.output}`;

  // Write tags if present
  if (exported.tags && exported.tags.length > 0) {
    yield `,\n${space}"tags": ${JSON.stringify(exported.tags)}`;
  }

  // Write memetic data if present
  if (exported.memetic) {
    yield `,\n${space}"memetic": ${JSON.stringify(exported.memetic)}`;
  }

  // Write neurons array incrementally
  yield `,\n${space}"neurons": [\n`;
  const neurons = exported.neurons;
  for (let i = 0; i < neurons.length; i++) {
    const neuronJson = JSON.stringify(neurons[i]);
    if (i > 0) {
      yield ",\n";
    }
    yield `${space}${space}${neuronJson}`;
  }
  yield `\n${space}]`;

  // Write synapses array incrementally
  yield `,\n${space}"synapses": [\n`;
  const synapses = exported.synapses;
  for (let i = 0; i < synapses.length; i++) {
    const synapseJson = JSON.stringify(synapses[i]);
    if (i > 0) {
      yield ",\n";
    }
    yield `${space}${space}${synapseJson}`;
  }
  yield `\n${space}]`;

  yield "\n}";
}

/**
 * Creates a sync generator that yields JSON chunks for a creature export.
 *
 * @param creature - The creature to serialise
 * @param indent - Number of spaces for indentation
 * @yields JSON string chunks
 */
export function* createStreamingCreatureWriterSync(
  creature: Creature,
  indent: number = 1,
): Generator<string> {
  const exported = creature.exportJSON();
  const space = " ".repeat(indent);

  yield "{\n";

  // Write metadata fields
  yield `${space}"semanticVersion": ${
    JSON.stringify(exported.semanticVersion)
  }`;

  if (exported.forwardOnly !== undefined) {
    yield `,\n${space}"forwardOnly": ${exported.forwardOnly}`;
  }

  // Write input/output counts
  yield `,\n${space}"input": ${exported.input}`;
  yield `,\n${space}"output": ${exported.output}`;

  // Write tags if present
  if (exported.tags && exported.tags.length > 0) {
    yield `,\n${space}"tags": ${JSON.stringify(exported.tags)}`;
  }

  // Write memetic data if present
  if (exported.memetic) {
    yield `,\n${space}"memetic": ${JSON.stringify(exported.memetic)}`;
  }

  // Write neurons array incrementally
  yield `,\n${space}"neurons": [\n`;
  const neurons = exported.neurons;
  for (let i = 0; i < neurons.length; i++) {
    const neuronJson = JSON.stringify(neurons[i]);
    if (i > 0) {
      yield ",\n";
    }
    yield `${space}${space}${neuronJson}`;
  }
  yield `\n${space}]`;

  // Write synapses array incrementally
  yield `,\n${space}"synapses": [\n`;
  const synapses = exported.synapses;
  for (let i = 0; i < synapses.length; i++) {
    const synapseJson = JSON.stringify(synapses[i]);
    if (i > 0) {
      yield ",\n";
    }
    yield `${space}${space}${synapseJson}`;
  }
  yield `\n${space}]`;

  yield "\n}";
}

/**
 * Streaming creature reader that can parse JSON from chunks.
 *
 * For the initial implementation, this accumulates chunks and parses the full JSON.
 * Future optimisations could implement true incremental JSON parsing.
 */
export class StreamingCreatureReader {
  /**
   * Reads a creature from an async generator of string chunks.
   *
   * @param chunks - Async generator yielding JSON string chunks
   * @returns The parsed creature
   */
  async readFromChunks(chunks: AsyncGenerator<string>): Promise<Creature> {
    const parts: string[] = [];
    for await (const chunk of chunks) {
      parts.push(chunk);
    }
    const json = parts.join("");
    const exported = JSON.parse(json) as CreatureExport;
    return Creature.fromJSON(exported);
  }

  /**
   * Reads a creature from a sync generator of string chunks.
   *
   * @param chunks - Generator yielding JSON string chunks
   * @returns The parsed creature
   */
  readFromChunksSync(chunks: Generator<string>): Creature {
    const parts: string[] = [];
    for (const chunk of chunks) {
      parts.push(chunk);
    }
    const json = parts.join("");
    const exported = JSON.parse(json) as CreatureExport;
    return Creature.fromJSON(exported);
  }
}

/**
 * Creates a streaming creature reader instance.
 *
 * @returns A new StreamingCreatureReader
 */
export function createStreamingCreatureReader(): StreamingCreatureReader {
  return new StreamingCreatureReader();
}

/**
 * Writes a creature to a file using streaming I/O.
 *
 * This method writes JSON incrementally to reduce peak memory usage
 * for large creatures.
 *
 * @param creature - The creature to write
 * @param filePath - The file path to write to
 */
export async function streamCreatureToFile(
  creature: Creature,
  filePath: string,
): Promise<void> {
  const file = await Deno.open(filePath, {
    write: true,
    create: true,
    truncate: true,
  });
  const encoder = new TextEncoder();

  try {
    for await (const chunk of createStreamingCreatureWriter(creature)) {
      await file.write(encoder.encode(chunk));
    }
  } finally {
    file.close();
  }
}

/**
 * Writes a creature to a file using streaming I/O (synchronous version).
 *
 * @param creature - The creature to write
 * @param filePath - The file path to write to
 */
export function streamCreatureToFileSync(
  creature: Creature,
  filePath: string,
): void {
  const file = Deno.openSync(filePath, {
    write: true,
    create: true,
    truncate: true,
  });
  const encoder = new TextEncoder();

  try {
    for (const chunk of createStreamingCreatureWriterSync(creature)) {
      file.writeSync(encoder.encode(chunk));
    }
  } finally {
    file.close();
  }
}

/**
 * Reads a creature from a file using streaming I/O.
 *
 * For large files, this reads in chunks to reduce memory pressure.
 *
 * @param filePath - The file path to read from
 * @param chunkSize - Size of read chunks in bytes (default: 64KB)
 * @returns The parsed creature
 */
export async function streamCreatureFromFile(
  filePath: string,
  chunkSize: number = 65536,
): Promise<Creature> {
  const file = await Deno.open(filePath, { read: true });
  const decoder = new TextDecoder();
  const parts: string[] = [];

  try {
    const buffer = new Uint8Array(chunkSize);
    let bytesRead: number | null;

    // deno-lint-ignore no-await-in-loop -- Intentional sequential I/O for streaming
    while ((bytesRead = await file.read(buffer)) !== null) {
      parts.push(
        decoder.decode(buffer.subarray(0, bytesRead), { stream: true }),
      );
    }

    // Flush any remaining bytes
    parts.push(decoder.decode(new Uint8Array(0), { stream: false }));
  } finally {
    file.close();
  }

  const json = parts.join("");
  const exported = JSON.parse(json) as CreatureExport;
  return Creature.fromJSON(exported);
}

/**
 * Reads a creature from a file using streaming I/O (synchronous version).
 *
 * @param filePath - The file path to read from
 * @param chunkSize - Size of read chunks in bytes (default: 64KB)
 * @returns The parsed creature
 */
export function streamCreatureFromFileSync(
  filePath: string,
  chunkSize: number = 65536,
): Creature {
  const file = Deno.openSync(filePath, { read: true });
  const decoder = new TextDecoder();
  const parts: string[] = [];

  try {
    const buffer = new Uint8Array(chunkSize);
    let bytesRead: number | null;

    while ((bytesRead = file.readSync(buffer)) !== null) {
      parts.push(
        decoder.decode(buffer.subarray(0, bytesRead), { stream: true }),
      );
    }

    // Flush any remaining bytes
    parts.push(decoder.decode(new Uint8Array(0), { stream: false }));
  } finally {
    file.close();
  }

  const json = parts.join("");
  const exported = JSON.parse(json) as CreatureExport;
  return Creature.fromJSON(exported);
}

/**
 * Writes a CreatureExport to a file using streaming I/O (synchronous version).
 *
 * @param exported - The creature export data
 * @param filePath - The file path to write to
 * @param indent - Number of spaces for indentation (default: 1)
 */
export function streamCreatureExportToFileSync(
  exported: CreatureExport,
  filePath: string,
  indent: number = 1,
): void {
  const file = Deno.openSync(filePath, {
    write: true,
    create: true,
    truncate: true,
  });
  const encoder = new TextEncoder();
  const space = " ".repeat(indent);

  try {
    file.writeSync(encoder.encode("{\n"));

    // Write metadata fields
    file.writeSync(
      encoder.encode(
        `${space}"semanticVersion": ${
          JSON.stringify(exported.semanticVersion)
        }`,
      ),
    );

    if (exported.forwardOnly !== undefined) {
      file.writeSync(
        encoder.encode(`,\n${space}"forwardOnly": ${exported.forwardOnly}`),
      );
    }

    file.writeSync(encoder.encode(`,\n${space}"input": ${exported.input}`));
    file.writeSync(encoder.encode(`,\n${space}"output": ${exported.output}`));

    if (exported.tags && exported.tags.length > 0) {
      file.writeSync(
        encoder.encode(`,\n${space}"tags": ${JSON.stringify(exported.tags)}`),
      );
    }

    if (exported.memetic) {
      file.writeSync(
        encoder.encode(
          `,\n${space}"memetic": ${JSON.stringify(exported.memetic)}`,
        ),
      );
    }

    // Write neurons
    file.writeSync(encoder.encode(`,\n${space}"neurons": [\n`));
    for (let i = 0; i < exported.neurons.length; i++) {
      if (i > 0) {
        file.writeSync(encoder.encode(",\n"));
      }
      file.writeSync(
        encoder.encode(
          `${space}${space}${JSON.stringify(exported.neurons[i])}`,
        ),
      );
    }
    file.writeSync(encoder.encode(`\n${space}]`));

    // Write synapses
    file.writeSync(encoder.encode(`,\n${space}"synapses": [\n`));
    for (let i = 0; i < exported.synapses.length; i++) {
      if (i > 0) {
        file.writeSync(encoder.encode(",\n"));
      }
      file.writeSync(
        encoder.encode(
          `${space}${space}${JSON.stringify(exported.synapses[i])}`,
        ),
      );
    }
    file.writeSync(encoder.encode(`\n${space}]`));

    file.writeSync(encoder.encode("\n}"));
  } finally {
    file.close();
  }
}

/**
 * Payload interface for discovery candidates that contain creature exports.
 */
export interface DiscoveryPayload {
  creature: CreatureExport;
  [key: string]: unknown;
}

/**
 * Writes a discovery payload (containing a creature) to a file using streaming I/O.
 *
 * The creature property is written incrementally to reduce memory pressure for
 * large creatures. Other properties are written using standard JSON serialisation.
 *
 * Issue #1296: Performance: Streaming JSON parsing for creature serialisation
 *
 * @param payload - The discovery payload containing a creature export
 * @param filePath - The file path to write to
 * @param indent - Number of spaces for indentation (default: 1)
 */
export function streamDiscoveryPayloadToFileSync(
  payload: DiscoveryPayload,
  filePath: string,
  indent: number = 1,
): void {
  const file = Deno.openSync(filePath, {
    write: true,
    create: true,
    truncate: true,
  });
  const encoder = new TextEncoder();
  const space = " ".repeat(indent);
  const space2 = " ".repeat(indent * 2);

  try {
    file.writeSync(encoder.encode("{\n"));

    // Write non-creature properties first
    let isFirst = true;
    for (const [key, value] of Object.entries(payload)) {
      if (key === "creature") continue;

      if (!isFirst) {
        file.writeSync(encoder.encode(",\n"));
      }
      isFirst = false;

      file.writeSync(
        encoder.encode(
          `${space}${JSON.stringify(key)}: ${JSON.stringify(value)}`,
        ),
      );
    }

    // Write the creature property using streaming
    const creature = payload.creature;
    if (!isFirst) {
      file.writeSync(encoder.encode(",\n"));
    }
    file.writeSync(encoder.encode(`${space}"creature": {\n`));

    // Write creature metadata fields
    file.writeSync(
      encoder.encode(
        `${space2}"semanticVersion": ${
          JSON.stringify(creature.semanticVersion)
        }`,
      ),
    );

    if (creature.forwardOnly !== undefined) {
      file.writeSync(
        encoder.encode(`,\n${space2}"forwardOnly": ${creature.forwardOnly}`),
      );
    }

    file.writeSync(encoder.encode(`,\n${space2}"input": ${creature.input}`));
    file.writeSync(encoder.encode(`,\n${space2}"output": ${creature.output}`));

    if (creature.tags && creature.tags.length > 0) {
      file.writeSync(
        encoder.encode(`,\n${space2}"tags": ${JSON.stringify(creature.tags)}`),
      );
    }

    if (creature.memetic) {
      file.writeSync(
        encoder.encode(
          `,\n${space2}"memetic": ${JSON.stringify(creature.memetic)}`,
        ),
      );
    }

    // Write neurons
    const space3 = " ".repeat(indent * 3);
    file.writeSync(encoder.encode(`,\n${space2}"neurons": [\n`));
    for (let i = 0; i < creature.neurons.length; i++) {
      if (i > 0) {
        file.writeSync(encoder.encode(",\n"));
      }
      file.writeSync(
        encoder.encode(`${space3}${JSON.stringify(creature.neurons[i])}`),
      );
    }
    file.writeSync(encoder.encode(`\n${space2}]`));

    // Write synapses
    file.writeSync(encoder.encode(`,\n${space2}"synapses": [\n`));
    for (let i = 0; i < creature.synapses.length; i++) {
      if (i > 0) {
        file.writeSync(encoder.encode(",\n"));
      }
      file.writeSync(
        encoder.encode(`${space3}${JSON.stringify(creature.synapses[i])}`),
      );
    }
    file.writeSync(encoder.encode(`\n${space2}]`));

    file.writeSync(encoder.encode(`\n${space}}`)); // Close creature object
    file.writeSync(encoder.encode("\n}")); // Close root object
  } finally {
    file.close();
  }
}
