import type { Creature } from "../Creature.ts";

/**
 * WGSL for scoring a batch directly from an interleaved record buffer.
 *
 * Layout per record:
 * - inputs:  [0..inputCount)
 * - targets: [inputCount..inputCount+outputCount)
 *
 * Output:
 * - perRecordMSE[recordIndex] = mean squared error for that record
 */
export function makeWGSLInterleavedMSEShader(
  creature: Creature,
  opts: { workgroupSize?: number } = {},
): { shaderCode: string; workgroupSize: number } {
  const workgroupSize = opts.workgroupSize ?? 64;
  const inputCount = creature.input;
  const outputCount = creature.output;
  const neuronCount = creature.neurons.length;

  return {
    workgroupSize,
    shaderCode:
      `// Interpreted WGSL: forward pass + per-record MSE directly from interleaved records
// Neurons: ${neuronCount}, Inputs: ${inputCount}, Outputs: ${outputCount}

struct Params {
  record_count: u32,
  input_count: u32,
  output_count: u32,
  neuron_count: u32,
  edge_count: u32,
  values_count: u32,
  _pad0: u32,
  _pad1: u32,
}

struct Neuron {
  start: u32,
  count: u32,
  ntype: u32,
  squash: u32,
  bias: f32,
  _pad0: f32,
  _pad1: f32,
  _pad2: f32,
}

struct Edge {
  from: u32,
  etype: u32,
  weight: f32,
  _pad0: f32,
}

@group(0) @binding(0) var<uniform> params: Params;
@group(0) @binding(1) var<storage, read> neurons: array<Neuron>;
@group(0) @binding(2) var<storage, read> edges: array<Edge>;
@group(0) @binding(3) var<storage, read> records: array<f32>;
@group(0) @binding(4) var<storage, read_write> perRecordMSE: array<f32>;

fn sanitise_clamp(x: f32, low: f32, high: f32, fallback: f32) -> f32 {
  let y = clamp(x, low, high);
  return select(fallback, y, y == y);
}

// Squash implementations (kept in sync with interpreter activation shader)
fn squash_IDENTITY(x: f32) -> f32 { return x; }
fn squash_ReLU(x: f32) -> f32 { return max(0.0, x); }
fn squash_LeakyReLU(x: f32) -> f32 { return select(0.01 * x, x, x > 0.0); }
fn squash_STEP(x: f32) -> f32 { return select(0.0, 1.0, x > 0.0); }
fn squash_BIPOLAR(x: f32) -> f32 { return select(-1.0, 1.0, x > 0.0); }
fn squash_HARD_TANH(x: f32) -> f32 { return clamp(x, -1.0, 1.0); }
fn squash_ABSOLUTE(x: f32) -> f32 { return abs(x); }
fn squash_SQUARE(x: f32) -> f32 { return x * x; }
fn squash_ReLU6(x: f32) -> f32 { return clamp(x, 0.0, 6.0); }
fn squash_BENT_IDENTITY(x: f32) -> f32 { return (sqrt(x * x + 1.0) - 1.0) / 2.0 + x; }

fn squash_TANH(x: f32) -> f32 {
  let y = tanh(clamp(x, -10.0, 10.0));
  return sanitise_clamp(y, -1.0, 1.0, 0.0);
}

fn squash_LOGISTIC(x: f32) -> f32 {
  let y = clamp(x, -80.0, 80.0);
  let v = 1.0 / (1.0 + exp(-y));
  return sanitise_clamp(v, 0.0, 1.0, 0.5);
}

fn squash_SINE(x: f32) -> f32 {
  let tau = 6.283185307179586;
  let k = round(x / tau);
  let r = x - k * tau;
  let v = sin(r);
  return sanitise_clamp(v, -1.0, 1.0, 0.0);
}

fn squash_Cosine(x: f32) -> f32 {
  let tau = 6.283185307179586;
  let k = round(x / tau);
  let r = x - k * tau;
  let v = cos(r);
  return sanitise_clamp(v, -1.0, 1.0, 1.0);
}

fn squash_SOFTSIGN(x: f32) -> f32 {
  let v = x / (1.0 + abs(x));
  return sanitise_clamp(v, -0.99, 0.99, 0.0);
}

fn squash_Softplus(x: f32) -> f32 {
  let y = clamp(x, -80.0, 100.0);
  let v = select(y, log(1.0 + exp(y)), y < 80.0);
  return sanitise_clamp(v, 1e-15, 100.0, 1e-15);
}

fn squash_ELU(x: f32) -> f32 { return select(exp(x) - 1.0, x, x >= 0.0); }

fn squash_SELU(x: f32) -> f32 {
  let alpha = 1.6732632423543772;
  let scale = 1.0507009873554805;
  let safeX = min(x, 709.0);
  let fx = select(alpha * (exp(safeX) - 1.0), safeX, safeX >= 0.0);
  let v = fx * scale;
  return sanitise_clamp(v, -9007199254740991.0, 9007199254740991.0, 0.0);
}

fn squash_GELU(x: f32) -> f32 {
  let inner = sqrt(2.0 / 3.14159265359) * (x + 0.044715 * x * x * x);
  let v = 0.5 * x * (1.0 + tanh(clamp(inner, -10.0, 10.0)));
  return sanitise_clamp(v, -1.0e20, 1.0e20, 0.0);
}

fn squash_GAUSSIAN(x: f32) -> f32 { return exp(-x * x); }

fn squash_TAN(x: f32) -> f32 {
  let pi = 3.141592653589793;
  let k = round(x / pi);
  let r = x - k * pi;
  let v = tan(r);
  return sanitise_clamp(v, -9007199254740991.0, 9007199254740991.0, 0.0);
}

fn squash_ArcTan(x: f32) -> f32 { return atan(x); }

fn squash_SQRT(x: f32) -> f32 {
  let v = select(0.0, sqrt(x), x > 0.0);
  return sanitise_clamp(v, 0.0, 1.0e20, 0.0);
}

fn squash_Cube(x: f32) -> f32 {
  let maxInput = 208008.38;
  if (abs(x) >= maxInput) {
    let s = select(1.0, -1.0, x < 0.0);
    return s * 9007199254740991.0;
  }
  let v = x * x * x;
  return sanitise_clamp(v, -9007199254740991.0, 9007199254740991.0, 0.0);
}

fn squash_Exponential(x: f32) -> f32 {
  if (x >= 36.0) {
    return 9007199254740991.0;
  }
  let v = exp(clamp(x, -80.0, 36.0));
  return sanitise_clamp(v, 0.0, 9007199254740991.0, 0.0);
}

fn squash_LogSigmoid(x: f32) -> f32 {
  if (x <= -709.0) {
    return -9007199254740991.0;
  }
  if (x < -80.0) {
    return sanitise_clamp(x, -9007199254740991.0, 0.0, -9007199254740991.0);
  }
  let v = -log(1.0 + exp(-x));
  return sanitise_clamp(v, -9007199254740991.0, 0.0, -log(2.0));
}

fn squash_Swish(x: f32) -> f32 {
  if (x < -20.0) {
    return sanitise_clamp(x, -9007199254740991.0, 9007199254740991.0, 0.0);
  }
  let v = x / (1.0 + exp(-x));
  return sanitise_clamp(v, -9007199254740991.0, 9007199254740991.0, 0.0);
}

fn squash_Mish(x: f32) -> f32 {
  if (x > 20.0) {
    return sanitise_clamp(x, -1.0e20, 1.0e20, 0.0);
  }
  if (x < -20.0) {
    return 0.0;
  }
  let y = clamp(x, -80.0, 80.0);
  let sp = log(1.0 + exp(y));
  let v = x * tanh(clamp(sp, -10.0, 10.0));
  return sanitise_clamp(v, -1.0e20, 1.0e20, 0.0);
}

fn squash_ISRU(x: f32) -> f32 {
  let y = clamp(x, -1.0e20, 1.0e20);
  let v = y / sqrt(1.0 + y * y);
  return sanitise_clamp(v, -1.0, 1.0, 0.0);
}

fn squash_StdInverse(x: f32) -> f32 {
  let ax = abs(x);
  let eps = select(-1.0e-15, 1.0e-15, x > 0.0);
  let safeX = select(x, eps, ax < 1.0e-15);
  let v = 1.0 / safeX;
  return sanitise_clamp(v, -9007199254740991.0, 9007199254740991.0, 0.0);
}

fn apply_squash(kind: u32, x: f32) -> f32 {
  switch kind {
    case 0u: { return squash_IDENTITY(x); }
    case 1u: { return squash_ReLU(x); }
    case 2u: { return squash_LeakyReLU(x); }
    case 3u: { return squash_STEP(x); }
    case 4u: { return squash_BIPOLAR(x); }
    case 5u: { return squash_HARD_TANH(x); }
    case 6u: { return squash_ABSOLUTE(x); }
    case 7u: { return squash_SQUARE(x); }
    case 8u: { return squash_ReLU6(x); }
    case 9u: { return squash_BENT_IDENTITY(x); }
    case 10u: { return squash_TANH(x); }
    case 11u: { return squash_LOGISTIC(x); }
    case 12u: { return squash_SINE(x); }
    case 13u: { return squash_Cosine(x); }
    case 14u: { return squash_SOFTSIGN(x); }
    case 15u: { return squash_Softplus(x); }
    case 16u: { return squash_ELU(x); }
    case 17u: { return squash_SELU(x); }
    case 18u: { return squash_GELU(x); }
    case 19u: { return squash_GAUSSIAN(x); }
    case 20u: { return squash_TAN(x); }
    case 21u: { return squash_ArcTan(x); }
    case 22u: { return squash_SQRT(x); }
    case 23u: { return squash_Cube(x); }
    case 24u: { return squash_Exponential(x); }
    case 25u: { return squash_LogSigmoid(x); }
    case 26u: { return squash_Swish(x); }
    case 27u: { return squash_Mish(x); }
    case 28u: { return squash_ISRU(x); }
    case 29u: { return squash_StdInverse(x); }
    default: { return x; }
  }
}

@compute @workgroup_size(${workgroupSize})
fn main(@builtin(global_invocation_id) global_id: vec3<u32>) {
  let idx = global_id.x;
  if (idx >= params.record_count) { return; }

  var a: array<f32, ${neuronCount}>;
  for (var z: u32 = 0u; z < params.neuron_count; z = z + 1u) { a[z] = 0.0; }

  let base = idx * params.values_count;
  for (var i: u32 = 0u; i < params.input_count; i = i + 1u) {
    a[i] = records[base + i];
  }

  for (var ni: u32 = params.input_count; ni < params.neuron_count; ni = ni + 1u) {
    let n = neurons[ni];
    if (n.ntype == 0u) { a[ni] = n.bias; continue; }

    if (n.ntype == 2u) {
      var cond: f32 = 0.0;
      var pos: f32 = n.bias;
      var neg: f32 = n.bias;
      for (var e: u32 = 0u; e < n.count; e = e + 1u) {
        let ed = edges[n.start + e];
        let v = a[ed.from] * ed.weight;
        if (ed.etype == 1u) { cond = cond + v; }
        else if (ed.etype == 2u) { pos = pos + v; }
        else if (ed.etype == 3u) { neg = neg + v; }
        else { pos = pos + v; }
      }
      a[ni] = select(neg, pos, cond > 0.0);
      continue;
    }

    if (n.ntype == 3u) {
      var best: f32 = 3.402823466e38;
      for (var e: u32 = 0u; e < n.count; e = e + 1u) {
        let ed = edges[n.start + e];
        let v = a[ed.from] * ed.weight;
        best = min(best, v);
      }
      a[ni] = sanitise_clamp(best + n.bias, -9007199254740991.0, 9007199254740991.0, 0.0);
      continue;
    }

    if (n.ntype == 4u) {
      var best: f32 = -3.402823466e38;
      for (var e: u32 = 0u; e < n.count; e = e + 1u) {
        let ed = edges[n.start + e];
        let v = a[ed.from] * ed.weight;
        best = max(best, v);
      }
      a[ni] = sanitise_clamp(best + n.bias, -9007199254740991.0, 9007199254740991.0, 0.0);
      continue;
    }

    var sum: f32 = n.bias;
    for (var e: u32 = 0u; e < n.count; e = e + 1u) {
      let ed = edges[n.start + e];
      sum = sum + a[ed.from] * ed.weight;
    }
    let clamped = clamp(sum, -1.0e20, 1.0e20);
    a[ni] = apply_squash(n.squash, clamped);
  }

  // MSE over outputs
  let first_output = params.neuron_count - params.output_count;
  var err: f32 = 0.0;
  let inv = 1.0 / f32(params.output_count);
  for (var o: u32 = 0u; o < params.output_count; o = o + 1u) {
    let outv = a[first_output + o];
    let tgt = records[base + params.input_count + o];
    let d = tgt - outv;
    err = err + d * d;
  }
  perRecordMSE[idx] = err * inv;
}
`,
  };
}
