/**
 * Minimal ONNX protobuf encoder.
 *
 * Issue #1866: Encodes ONNX ModelProto messages in Protocol Buffers wire format
 * without requiring an external protobuf library. Only the subset of the ONNX
 * specification needed for exporting NEAT creatures is implemented.
 *
 * References:
 * - ONNX IR spec: https://github.com/onnx/onnx/blob/main/docs/IR.md
 * - Protobuf encoding: https://protobuf.dev/programming-guides/encoding/
 */

// ── Protobuf wire-format helpers ─────────────────────────────────────────

/** Encodes an unsigned integer as a varint. */
function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = [];
  let v = value >>> 0; // ensure unsigned 32-bit
  while (v > 0x7f) {
    bytes.push((v & 0x7f) | 0x80);
    v >>>= 7;
  }
  bytes.push(v & 0x7f);
  return new Uint8Array(bytes);
}

/** Encodes a signed 64-bit integer as a varint (supports up to 2^53 - 1). */
function encodeVarint64(value: number): Uint8Array {
  const bytes: number[] = [];
  // Use BigInt for proper 64-bit varint encoding
  let v = BigInt(value);
  if (v < 0n) {
    // Two's complement for negative values
    v = v + (1n << 64n);
  }
  while (v > 0x7fn) {
    bytes.push(Number(v & 0x7fn) | 0x80);
    v >>= 7n;
  }
  bytes.push(Number(v & 0x7fn));
  return new Uint8Array(bytes);
}

/** Encodes a float32 as 4 little-endian bytes. */
function encodeFloat(value: number): Uint8Array {
  const buf = new ArrayBuffer(4);
  new DataView(buf).setFloat32(0, value, true);
  return new Uint8Array(buf);
}

/** Encodes a string as UTF-8 bytes. */
function encodeString(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

/** Writes a protobuf field tag (field number + wire type). */
function encodeTag(fieldNumber: number, wireType: number): Uint8Array {
  return encodeVarint((fieldNumber << 3) | wireType);
}

/** Encodes a length-delimited protobuf field. */
function encodeLengthDelimited(
  fieldNumber: number,
  data: Uint8Array,
): Uint8Array {
  const tag = encodeTag(fieldNumber, 2);
  const length = encodeVarint(data.length);
  const result = new Uint8Array(tag.length + length.length + data.length);
  result.set(tag, 0);
  result.set(length, tag.length);
  result.set(data, tag.length + length.length);
  return result;
}

/** Encodes a varint protobuf field. */
function encodeVarintField(fieldNumber: number, value: number): Uint8Array {
  const tag = encodeTag(fieldNumber, 0);
  const val = encodeVarint64(value);
  const result = new Uint8Array(tag.length + val.length);
  result.set(tag, 0);
  result.set(val, tag.length);
  return result;
}

/** Encodes a string protobuf field. */
function encodeStringField(fieldNumber: number, value: string): Uint8Array {
  return encodeLengthDelimited(fieldNumber, encodeString(value));
}

/** Concatenates multiple Uint8Arrays. */
function concatBytes(...arrays: Uint8Array[]): Uint8Array {
  let totalLength = 0;
  for (const arr of arrays) totalLength += arr.length;
  const result = new Uint8Array(totalLength);
  let offset = 0;
  for (const arr of arrays) {
    result.set(arr, offset);
    offset += arr.length;
  }
  return result;
}

// ── ONNX data types ─────────────────────────────────────────────────────

/** ONNX TensorProto.DataType values. */
export const ONNX_TENSOR_TYPE = {
  FLOAT: 1,
} as const;

/** ONNX IR version constants. */
const ONNX_IR_VERSION = 8;
const ONNX_OPSET_VERSION = 17;

// ── ONNX message encoders ───────────────────────────────────────────────

/**
 * Encodes an ONNX TensorProto message.
 *
 * TensorProto fields:
 *   1: dims (repeated int64)
 *   2: data_type (int32)
 *   5: float_data (repeated float, packed)
 *   8: name (string)
 */
export function encodeTensorProto(
  name: string,
  dims: number[],
  floatData: number[],
): Uint8Array {
  const parts: Uint8Array[] = [];

  // dims (field 1, repeated int64)
  for (const dim of dims) {
    parts.push(encodeVarintField(1, dim));
  }

  // data_type (field 2)
  parts.push(encodeVarintField(2, ONNX_TENSOR_TYPE.FLOAT));

  // float_data (field 5, packed)
  const floatBytes = new Uint8Array(floatData.length * 4);
  for (let i = 0; i < floatData.length; i++) {
    floatBytes.set(encodeFloat(floatData[i]), i * 4);
  }
  parts.push(encodeLengthDelimited(5, floatBytes));

  // name (field 8)
  parts.push(encodeStringField(8, name));

  return concatBytes(...parts);
}

/**
 * Encodes an ONNX AttributeProto message.
 *
 * AttributeProto fields:
 *   1: name (string)
 *   2: f (float) - for FLOAT type
 *   3: i (int64) - for INT type
 *   4: s (bytes) - for STRING type
 *   20: type (AttributeType enum)
 */
export function encodeAttributeFloat(
  name: string,
  value: number,
): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(encodeStringField(1, name));
  // f (field 2, fixed32 wire type 5)
  const tag = encodeTag(2, 5);
  const fBytes = encodeFloat(value);
  const floatField = new Uint8Array(tag.length + fBytes.length);
  floatField.set(tag, 0);
  floatField.set(fBytes, tag.length);
  parts.push(floatField);
  // type = FLOAT (1)
  parts.push(encodeVarintField(20, 1));
  return concatBytes(...parts);
}

export function encodeAttributeString(
  name: string,
  value: string,
): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(encodeStringField(1, name));
  // s (field 4, bytes)
  parts.push(encodeLengthDelimited(4, encodeString(value)));
  // type = STRING (3)
  parts.push(encodeVarintField(20, 3));
  return concatBytes(...parts);
}

export function encodeAttributeInt(
  name: string,
  value: number,
): Uint8Array {
  const parts: Uint8Array[] = [];
  parts.push(encodeStringField(1, name));
  // i (field 3, int64)
  parts.push(encodeVarintField(3, value));
  // type = INT (2)
  parts.push(encodeVarintField(20, 2));
  return concatBytes(...parts);
}

/**
 * Encodes an ONNX NodeProto message.
 *
 * NodeProto fields:
 *   1: input (repeated string)
 *   2: output (repeated string)
 *   3: name (string)
 *   4: op_type (string)
 *   5: attribute (repeated AttributeProto)
 *   7: domain (string)
 */
export function encodeNodeProto(
  inputs: string[],
  outputs: string[],
  name: string,
  opType: string,
  attributes: Uint8Array[] = [],
  domain = "",
): Uint8Array {
  const parts: Uint8Array[] = [];

  for (const inp of inputs) {
    parts.push(encodeStringField(1, inp));
  }
  for (const out of outputs) {
    parts.push(encodeStringField(2, out));
  }
  parts.push(encodeStringField(3, name));
  parts.push(encodeStringField(4, opType));
  for (const attr of attributes) {
    parts.push(encodeLengthDelimited(5, attr));
  }
  if (domain) {
    parts.push(encodeStringField(7, domain));
  }

  return concatBytes(...parts);
}

/**
 * Encodes an ONNX TypeProto for a tensor.
 *
 * TypeProto fields:
 *   1: tensor_type (TypeProto.Tensor, embedded message)
 *
 * TypeProto.Tensor fields:
 *   1: elem_type (int32)
 *   2: shape (TensorShapeProto, embedded message)
 *
 * TensorShapeProto fields:
 *   1: dim (repeated Dimension)
 *
 * Dimension fields:
 *   2: dim_value (int64)
 *   3: dim_param (string) — for symbolic dimensions
 */
function encodeTensorTypeProto(
  elemType: number,
  shape: (number | string)[],
): Uint8Array {
  // Build shape dimensions
  const dimParts: Uint8Array[] = [];
  for (const dim of shape) {
    if (typeof dim === "number") {
      // dim_value (field 2)
      dimParts.push(encodeLengthDelimited(1, encodeVarintField(2, dim)));
    } else {
      // dim_param (field 3)
      dimParts.push(encodeLengthDelimited(1, encodeStringField(3, dim)));
    }
  }
  const shapeProto = concatBytes(...dimParts);

  // TensorTypeProto
  const tensorType = concatBytes(
    encodeVarintField(1, elemType),
    encodeLengthDelimited(2, shapeProto),
  );

  // TypeProto
  return encodeLengthDelimited(1, tensorType);
}

/**
 * Encodes an ONNX ValueInfoProto message.
 *
 * ValueInfoProto fields:
 *   1: name (string)
 *   2: type (TypeProto)
 */
export function encodeValueInfoProto(
  name: string,
  elemType: number,
  shape: (number | string)[],
): Uint8Array {
  return concatBytes(
    encodeStringField(1, name),
    encodeLengthDelimited(2, encodeTensorTypeProto(elemType, shape)),
  );
}

/**
 * Encodes an ONNX GraphProto message.
 *
 * GraphProto fields:
 *   1: node (repeated NodeProto)
 *   2: name (string)
 *   5: initializer (repeated TensorProto)
 *   11: input (repeated ValueInfoProto)
 *   12: output (repeated ValueInfoProto)
 */
export function encodeGraphProto(
  name: string,
  nodes: Uint8Array[],
  inputs: Uint8Array[],
  outputs: Uint8Array[],
  initialisers: Uint8Array[],
): Uint8Array {
  const parts: Uint8Array[] = [];

  for (const node of nodes) {
    parts.push(encodeLengthDelimited(1, node));
  }
  parts.push(encodeStringField(2, name));
  for (const init of initialisers) {
    parts.push(encodeLengthDelimited(5, init));
  }
  for (const inp of inputs) {
    parts.push(encodeLengthDelimited(11, inp));
  }
  for (const out of outputs) {
    parts.push(encodeLengthDelimited(12, out));
  }

  return concatBytes(...parts);
}

/**
 * Encodes an ONNX OperatorSetIdProto.
 *
 * OperatorSetIdProto fields:
 *   1: domain (string)
 *   2: version (int64)
 */
function encodeOpsetImport(domain: string, version: number): Uint8Array {
  const parts: Uint8Array[] = [];
  if (domain) {
    parts.push(encodeStringField(1, domain));
  }
  parts.push(encodeVarintField(2, version));
  return concatBytes(...parts);
}

/**
 * Encodes an ONNX ModelProto message.
 *
 * ModelProto fields:
 *   1: ir_version (int64)
 *   2: producer_name (string)
 *   3: producer_version (string)
 *   4: domain (string)
 *   5: model_version (int64)
 *   7: graph (GraphProto)
 *   8: opset_import (repeated OperatorSetIdProto)
 */
export function encodeModelProto(
  graph: Uint8Array,
  producerName: string,
  producerVersion: string,
  domain: string,
  modelVersion: number,
): Uint8Array {
  const parts: Uint8Array[] = [];

  parts.push(encodeVarintField(1, ONNX_IR_VERSION));
  parts.push(encodeOpsetImportField(8, "", ONNX_OPSET_VERSION));
  parts.push(encodeStringField(2, producerName));
  parts.push(encodeStringField(3, producerVersion));
  if (domain) {
    parts.push(encodeStringField(4, domain));
  }
  parts.push(encodeVarintField(5, modelVersion));
  parts.push(encodeLengthDelimited(7, graph));

  return concatBytes(...parts);
}

/** Encodes an opset_import field (embedded message in ModelProto field 8). */
function encodeOpsetImportField(
  fieldNumber: number,
  domain: string,
  version: number,
): Uint8Array {
  return encodeLengthDelimited(
    fieldNumber,
    encodeOpsetImport(domain, version),
  );
}
