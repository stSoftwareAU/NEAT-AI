/**
 * ONNX model builder types and encoding functions.
 *
 * Issue #1866: Provides TypeScript types matching the ONNX protobuf schema
 * and encoding functions that produce valid ONNX binary format.
 *
 * Reference: https://github.com/onnx/onnx/blob/main/onnx/onnx.proto
 */

import { ProtobufWriter } from "./ProtobufEncoder.ts";

// ONNX IR version 9 (opset 19 compatible)
const ONNX_IR_VERSION = 9;

/** ONNX TensorProto data types */
export const enum OnnxDataType {
  FLOAT = 1,
  INT64 = 7,
  DOUBLE = 11,
}

/** ONNX AttributeProto types */
export const enum OnnxAttributeType {
  FLOAT = 1,
  INT = 2,
  STRING = 3,
  FLOATS = 6,
  INTS = 7,
}

/** An ONNX tensor dimension (either fixed or symbolic). */
export interface OnnxDimension {
  dimValue?: number;
  dimParam?: string;
}

/** An ONNX attribute on a node. */
export interface OnnxAttribute {
  name: string;
  type: OnnxAttributeType;
  f?: number;
  i?: number;
  s?: string;
  floats?: number[];
  ints?: number[];
}

/** An ONNX computational graph node. */
export interface OnnxNode {
  inputs: string[];
  outputs: string[];
  name: string;
  opType: string;
  attributes?: OnnxAttribute[];
}

/** An ONNX tensor initialiser (constant weights/biases). */
export interface OnnxTensor {
  name: string;
  dataType: OnnxDataType;
  dims: number[];
  floatData?: number[];
}

/** An ONNX value info (describes a tensor's name, type, and shape). */
export interface OnnxValueInfo {
  name: string;
  elemType: OnnxDataType;
  shape: OnnxDimension[];
}

/** An ONNX graph. */
export interface OnnxGraph {
  name: string;
  nodes: OnnxNode[];
  inputs: OnnxValueInfo[];
  outputs: OnnxValueInfo[];
  initialisers: OnnxTensor[];
}

/** Top-level ONNX model. */
export interface OnnxModel {
  irVersion: number;
  opsetVersion: number;
  producerName: string;
  producerVersion: string;
  graph: OnnxGraph;
}

/** Encode an OnnxAttribute to protobuf bytes. */
function encodeAttribute(attr: OnnxAttribute): Uint8Array {
  const w = new ProtobufWriter();
  // field 1: name (string)
  w.writeStringField(1, attr.name);
  // field 20: type (enum/varint)
  w.writeVarintField(20, attr.type);
  switch (attr.type) {
    case OnnxAttributeType.FLOAT:
      // field 4: f (float)
      if (attr.f !== undefined) w.writeFloat32Field(4, attr.f);
      break;
    case OnnxAttributeType.INT:
      // field 3: i (int64)
      if (attr.i !== undefined) w.writeVarintField(3, attr.i);
      break;
    case OnnxAttributeType.STRING:
      // field 4 is f, field 5 is not used for bytes in this context
      // Actually: AttributeProto field 4 = bytes s
      if (attr.s !== undefined) {
        const encoded = new TextEncoder().encode(attr.s);
        w.writeBytesField(4, encoded);
      }
      break;
    case OnnxAttributeType.FLOATS:
      // field 7: floats (packed float)
      if (attr.floats) w.writePackedFloatField(7, attr.floats);
      break;
    case OnnxAttributeType.INTS:
      // field 8: ints (packed int64)
      if (attr.ints) w.writePackedInt64Field(8, attr.ints);
      break;
  }
  return w.finish();
}

/** Encode an OnnxNode to protobuf bytes. */
function encodeNode(node: OnnxNode): Uint8Array {
  const w = new ProtobufWriter();
  // field 1: repeated string input
  for (const input of node.inputs) {
    w.writeStringField(1, input);
  }
  // field 2: repeated string output
  for (const output of node.outputs) {
    w.writeStringField(2, output);
  }
  // field 3: string name
  w.writeStringField(3, node.name);
  // field 4: string op_type
  w.writeStringField(4, node.opType);
  // field 5: repeated AttributeProto attribute
  if (node.attributes) {
    for (const attr of node.attributes) {
      w.writeMessageField(5, encodeAttribute(attr));
    }
  }
  return w.finish();
}

/** Encode an OnnxTensor to protobuf bytes. */
function encodeTensor(tensor: OnnxTensor): Uint8Array {
  const w = new ProtobufWriter();
  // field 1: repeated int64 dims (packed)
  w.writePackedInt64Field(1, tensor.dims);
  // field 2: int32 data_type
  w.writeVarintField(2, tensor.dataType);
  // field 8: string name
  w.writeStringField(8, tensor.name);
  // field 4: repeated float float_data (packed)
  if (tensor.floatData) {
    w.writePackedFloatField(4, tensor.floatData);
  }
  return w.finish();
}

/** Encode a TensorShapeProto.Dimension to protobuf bytes. */
function encodeDimension(dim: OnnxDimension): Uint8Array {
  const w = new ProtobufWriter();
  if (dim.dimValue !== undefined) {
    // field 1: int64 dim_value
    w.writeVarintField(1, dim.dimValue);
  }
  if (dim.dimParam !== undefined) {
    // field 2: string dim_param
    w.writeStringField(2, dim.dimParam);
  }
  return w.finish();
}

/** Encode a TensorShapeProto to protobuf bytes. */
function encodeTensorShape(dims: OnnxDimension[]): Uint8Array {
  const w = new ProtobufWriter();
  for (const dim of dims) {
    // field 1: repeated Dimension dim
    w.writeMessageField(1, encodeDimension(dim));
  }
  return w.finish();
}

/** Encode a TypeProto.Tensor to protobuf bytes. */
function encodeTensorType(
  elemType: OnnxDataType,
  shape: OnnxDimension[],
): Uint8Array {
  const w = new ProtobufWriter();
  // field 1: int32 elem_type
  w.writeVarintField(1, elemType);
  // field 2: TensorShapeProto shape
  w.writeMessageField(2, encodeTensorShape(shape));
  return w.finish();
}

/** Encode a TypeProto to protobuf bytes. */
function encodeTypeProto(
  elemType: OnnxDataType,
  shape: OnnxDimension[],
): Uint8Array {
  const w = new ProtobufWriter();
  // field 1: TypeProto.Tensor tensor_type (oneof)
  w.writeMessageField(1, encodeTensorType(elemType, shape));
  return w.finish();
}

/** Encode an OnnxValueInfo to protobuf bytes. */
function encodeValueInfo(vi: OnnxValueInfo): Uint8Array {
  const w = new ProtobufWriter();
  // field 1: string name
  w.writeStringField(1, vi.name);
  // field 2: TypeProto type
  w.writeMessageField(2, encodeTypeProto(vi.elemType, vi.shape));
  return w.finish();
}

/** Encode an OnnxGraph to protobuf bytes. */
function encodeGraph(graph: OnnxGraph): Uint8Array {
  const w = new ProtobufWriter();
  // field 1: repeated NodeProto node
  for (const node of graph.nodes) {
    w.writeMessageField(1, encodeNode(node));
  }
  // field 2: string name
  w.writeStringField(2, graph.name);
  // field 5: repeated TensorProto initializer
  for (const init of graph.initialisers) {
    w.writeMessageField(5, encodeTensor(init));
  }
  // field 11: repeated ValueInfoProto input
  for (const input of graph.inputs) {
    w.writeMessageField(11, encodeValueInfo(input));
  }
  // field 12: repeated ValueInfoProto output
  for (const output of graph.outputs) {
    w.writeMessageField(12, encodeValueInfo(output));
  }
  return w.finish();
}

/** Encode an OperatorSetIdProto to protobuf bytes. */
function encodeOpsetImport(version: number): Uint8Array {
  const w = new ProtobufWriter();
  // field 1: string domain (empty string = default ONNX domain)
  // We skip it since empty string is the default
  // field 2: int64 version
  w.writeVarintField(2, version);
  return w.finish();
}

/** Encode an OnnxModel to a complete ONNX protobuf binary. */
export function encodeOnnxModel(model: OnnxModel): Uint8Array {
  const w = new ProtobufWriter();
  // field 1: int64 ir_version
  w.writeVarintField(1, model.irVersion);
  // field 8: repeated OperatorSetIdProto opset_import
  w.writeMessageField(8, encodeOpsetImport(model.opsetVersion));
  // field 2: string producer_name
  w.writeStringField(2, model.producerName);
  // field 3: string producer_version
  w.writeStringField(3, model.producerVersion);
  // field 7: GraphProto graph
  w.writeMessageField(7, encodeGraph(model.graph));
  return w.finish();
}

/** Create a default ONNX model structure. */
export function createOnnxModel(graph: OnnxGraph): OnnxModel {
  return {
    irVersion: ONNX_IR_VERSION,
    opsetVersion: 19,
    producerName: "NEAT-AI",
    producerVersion: "1.0.0",
    graph,
  };
}
