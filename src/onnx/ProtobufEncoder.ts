/**
 * Minimal Protocol Buffers encoder for ONNX binary format.
 *
 * Issue #1866: Implements only the subset of protobuf wire format
 * needed to produce valid ONNX model files. Supports varint,
 * fixed32, fixed64, length-delimited fields (strings, bytes,
 * submessages), and packed repeated fields.
 *
 * Reference: https://protobuf.dev/programming-guides/encoding/
 */

/** Wire types used in Protocol Buffers encoding. */
const WIRE_TYPE_VARINT = 0;
const WIRE_TYPE_64BIT = 1;
const WIRE_TYPE_LENGTH_DELIMITED = 2;
const WIRE_TYPE_32BIT = 5;

/**
 * Low-level Protocol Buffers writer.
 *
 * Accumulates encoded fields into an internal byte buffer.
 * Call {@link finish} to retrieve the final `Uint8Array`.
 */
export class ProtobufWriter {
  private chunks: Uint8Array[] = [];
  private totalLength = 0;

  /** Write a varint (unsigned LEB128). */
  writeVarint(value: number | bigint): void {
    let v = typeof value === "bigint" ? value : BigInt(value);
    if (v < 0n) {
      // Encode as two's complement (10 bytes for negative)
      v = v + (1n << 64n);
    }
    const bytes: number[] = [];
    do {
      let byte = Number(v & 0x7fn);
      v >>= 7n;
      if (v > 0n) byte |= 0x80;
      bytes.push(byte);
    } while (v > 0n);
    this.writeRawBytes(new Uint8Array(bytes));
  }

  /** Write a field tag (field number + wire type). */
  writeTag(fieldNumber: number, wireType: number): void {
    this.writeVarint((fieldNumber << 3) | wireType);
  }

  /** Write a varint field. */
  writeVarintField(fieldNumber: number, value: number | bigint): void {
    this.writeTag(fieldNumber, WIRE_TYPE_VARINT);
    this.writeVarint(value);
  }

  /** Write a fixed 32-bit float field. */
  writeFloat32Field(fieldNumber: number, value: number): void {
    this.writeTag(fieldNumber, WIRE_TYPE_32BIT);
    const buf = new ArrayBuffer(4);
    new DataView(buf).setFloat32(0, value, true);
    this.writeRawBytes(new Uint8Array(buf));
  }

  /** Write a fixed 64-bit double field. */
  writeFloat64Field(fieldNumber: number, value: number): void {
    this.writeTag(fieldNumber, WIRE_TYPE_64BIT);
    const buf = new ArrayBuffer(8);
    new DataView(buf).setFloat64(0, value, true);
    this.writeRawBytes(new Uint8Array(buf));
  }

  /** Write a length-delimited string field (UTF-8). */
  writeStringField(fieldNumber: number, value: string): void {
    if (value.length === 0) return;
    const encoded = new TextEncoder().encode(value);
    this.writeTag(fieldNumber, WIRE_TYPE_LENGTH_DELIMITED);
    this.writeVarint(encoded.length);
    this.writeRawBytes(encoded);
  }

  /** Write a length-delimited bytes field. */
  writeBytesField(fieldNumber: number, value: Uint8Array): void {
    if (value.length === 0) return;
    this.writeTag(fieldNumber, WIRE_TYPE_LENGTH_DELIMITED);
    this.writeVarint(value.length);
    this.writeRawBytes(value);
  }

  /** Write an embedded message field (length-delimited). */
  writeMessageField(fieldNumber: number, message: Uint8Array): void {
    this.writeTag(fieldNumber, WIRE_TYPE_LENGTH_DELIMITED);
    this.writeVarint(message.length);
    this.writeRawBytes(message);
  }

  /**
   * Write a packed repeated int64 field.
   * Values are encoded as varints within a single length-delimited block.
   */
  writePackedInt64Field(fieldNumber: number, values: number[]): void {
    if (values.length === 0) return;
    const inner = new ProtobufWriter();
    for (const v of values) {
      inner.writeVarint(v);
    }
    const packed = inner.finish();
    this.writeTag(fieldNumber, WIRE_TYPE_LENGTH_DELIMITED);
    this.writeVarint(packed.length);
    this.writeRawBytes(packed);
  }

  /**
   * Write a packed repeated float field.
   * Values are encoded as fixed 32-bit floats within a single length-delimited block.
   */
  writePackedFloatField(fieldNumber: number, values: number[]): void {
    if (values.length === 0) return;
    const buf = new ArrayBuffer(values.length * 4);
    const view = new DataView(buf);
    for (let i = 0; i < values.length; i++) {
      view.setFloat32(i * 4, values[i], true);
    }
    this.writeTag(fieldNumber, WIRE_TYPE_LENGTH_DELIMITED);
    this.writeVarint(values.length * 4);
    this.writeRawBytes(new Uint8Array(buf));
  }

  /** Append raw bytes to the buffer. */
  writeRawBytes(bytes: Uint8Array): void {
    this.chunks.push(bytes);
    this.totalLength += bytes.length;
  }

  /** Finalise and return the encoded bytes. */
  finish(): Uint8Array {
    const result = new Uint8Array(this.totalLength);
    let offset = 0;
    for (const chunk of this.chunks) {
      result.set(chunk, offset);
      offset += chunk.length;
    }
    return result;
  }
}
