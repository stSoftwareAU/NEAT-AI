/**
 * Tests for the minimal Protocol Buffers encoder.
 *
 * Issue #1866: Verifies varint encoding, field tags, and various
 * data type encodings used in the ONNX protobuf format.
 */

import { assertEquals } from "@std/assert";
import { ProtobufWriter } from "../../src/onnx/ProtobufEncoder.ts";

Deno.test("ProtobufWriter encodes single-byte varint", () => {
  const w = new ProtobufWriter();
  w.writeVarint(5);
  const bytes = w.finish();
  assertEquals(bytes.length, 1);
  assertEquals(bytes[0], 5);
});

Deno.test("ProtobufWriter encodes multi-byte varint", () => {
  const w = new ProtobufWriter();
  // 300 = 0b100101100
  // In LEB128: byte1 = 0b10101100 (0xAC), byte2 = 0b00000010 (0x02)
  w.writeVarint(300);
  const bytes = w.finish();
  assertEquals(bytes.length, 2);
  assertEquals(bytes[0], 0xAC);
  assertEquals(bytes[1], 0x02);
});

Deno.test("ProtobufWriter encodes zero varint", () => {
  const w = new ProtobufWriter();
  w.writeVarint(0);
  const bytes = w.finish();
  assertEquals(bytes.length, 1);
  assertEquals(bytes[0], 0);
});

Deno.test("ProtobufWriter encodes field tag", () => {
  const w = new ProtobufWriter();
  // Field 1, wire type 0 (varint) → tag = (1 << 3) | 0 = 8
  w.writeTag(1, 0);
  const bytes = w.finish();
  assertEquals(bytes[0], 0x08);
});

Deno.test("ProtobufWriter encodes string field", () => {
  const w = new ProtobufWriter();
  w.writeStringField(2, "test");
  const bytes = w.finish();
  // Tag: field 2, wire type 2 → (2 << 3) | 2 = 18 = 0x12
  assertEquals(bytes[0], 0x12);
  // Length: 4
  assertEquals(bytes[1], 4);
  // "test" in UTF-8
  const text = new TextDecoder().decode(bytes.slice(2));
  assertEquals(text, "test");
});

Deno.test("ProtobufWriter skips empty string field", () => {
  const w = new ProtobufWriter();
  w.writeStringField(1, "");
  const bytes = w.finish();
  assertEquals(bytes.length, 0);
});

Deno.test("ProtobufWriter encodes varint field", () => {
  const w = new ProtobufWriter();
  w.writeVarintField(1, 9);
  const bytes = w.finish();
  // Tag: field 1, wire type 0 → 0x08
  assertEquals(bytes[0], 0x08);
  // Value: 9
  assertEquals(bytes[1], 9);
});

Deno.test("ProtobufWriter encodes float32 field", () => {
  const w = new ProtobufWriter();
  w.writeFloat32Field(4, 1.5);
  const bytes = w.finish();
  // Tag: field 4, wire type 5 → (4 << 3) | 5 = 37 = 0x25
  assertEquals(bytes[0], 0x25);
  // 4 bytes for the float
  assertEquals(bytes.length, 5);
  // Verify the float value
  const view = new DataView(bytes.buffer, bytes.byteOffset + 1, 4);
  const val = view.getFloat32(0, true);
  assertEquals(val, 1.5);
});

Deno.test("ProtobufWriter encodes float64 field", () => {
  const w = new ProtobufWriter();
  w.writeFloat64Field(5, 3.14);
  const bytes = w.finish();
  // Tag: field 5, wire type 1 → (5 << 3) | 1 = 41 = 0x29
  assertEquals(bytes[0], 0x29);
  // 8 bytes for the double
  assertEquals(bytes.length, 9);
  const view = new DataView(bytes.buffer, bytes.byteOffset + 1, 8);
  const val = view.getFloat64(0, true);
  assertEquals(val, 3.14);
});

Deno.test("ProtobufWriter encodes packed float field", () => {
  const w = new ProtobufWriter();
  w.writePackedFloatField(4, [1.0, 2.0, 3.0]);
  const bytes = w.finish();
  // Tag: field 4, wire type 2 (length-delimited) → (4 << 3) | 2 = 34 = 0x22
  assertEquals(bytes[0], 0x22);
  // Length: 3 floats * 4 bytes = 12
  assertEquals(bytes[1], 12);
  // Total: 1 (tag) + 1 (length) + 12 (data) = 14
  assertEquals(bytes.length, 14);
});

Deno.test("ProtobufWriter encodes packed int64 field", () => {
  const w = new ProtobufWriter();
  w.writePackedInt64Field(1, [1, 2, 3]);
  const bytes = w.finish();
  // Tag: field 1, wire type 2 → (1 << 3) | 2 = 10 = 0x0A
  assertEquals(bytes[0], 0x0A);
  // Three single-byte varints = 3 bytes
  assertEquals(bytes[1], 3);
  assertEquals(bytes[2], 1);
  assertEquals(bytes[3], 2);
  assertEquals(bytes[4], 3);
});

Deno.test("ProtobufWriter encodes message field", () => {
  // Build an inner message
  const inner = new ProtobufWriter();
  inner.writeVarintField(1, 42);
  const innerBytes = inner.finish();

  // Embed it in an outer message
  const outer = new ProtobufWriter();
  outer.writeMessageField(7, innerBytes);
  const bytes = outer.finish();

  // Tag: field 7, wire type 2 → (7 << 3) | 2 = 58 = 0x3A
  assertEquals(bytes[0], 0x3A);
  // Length: inner message size
  assertEquals(bytes[1], innerBytes.length);
});

Deno.test("ProtobufWriter handles multiple fields", () => {
  const w = new ProtobufWriter();
  w.writeVarintField(1, 9);
  w.writeStringField(2, "NEAT-AI");
  const bytes = w.finish();

  // First field: tag 0x08, value 9
  assertEquals(bytes[0], 0x08);
  assertEquals(bytes[1], 9);
  // Second field: tag 0x12, length 7, "NEAT-AI"
  assertEquals(bytes[2], 0x12);
  assertEquals(bytes[3], 7);
  const text = new TextDecoder().decode(bytes.slice(4));
  assertEquals(text, "NEAT-AI");
});
