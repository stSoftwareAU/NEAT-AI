import type { Creature } from "../Creature.ts";
import { makeWGSLInterpreterShader } from "./MakeWGSLInterpreterShader.ts";

type WGPUInterpreterConfig = {
  workgroupSize?: number;
  maxBatchSize?: number;
};

type NeuronRecord = {
  start: number;
  count: number;
  ntype: number;
  squash: number;
  bias: number;
};

type EdgeRecord = {
  from: number;
  etype: number;
  weight: number;
};

const DEFAULT_CONFIG: Required<WGPUInterpreterConfig> = {
  workgroupSize: 64,
  maxBatchSize: 4096,
};

function squashToEnum(name: string): number {
  switch (name) {
    case "IDENTITY":
      return 0;
    case "ReLU":
      return 1;
    case "LeakyReLU":
      return 2;
    case "STEP":
      return 3;
    case "BIPOLAR":
      return 4;
    case "HARD_TANH":
      return 5;
    case "ABSOLUTE":
      return 6;
    case "SQUARE":
      return 7;
    case "ReLU6":
      return 8;
    case "BENT_IDENTITY":
      return 9;
    case "TANH":
      return 10;
    case "LOGISTIC":
      return 11;
    case "SINE":
      return 12;
    case "Cosine":
      return 13;
    case "SOFTSIGN":
      return 14;
    case "Softplus":
      return 15;
    case "ELU":
      return 16;
    case "SELU":
      return 17;
    case "GELU":
      return 18;
    case "GAUSSIAN":
      return 19;
    case "TAN":
      return 20;
    case "ArcTan":
      return 21;
    case "SQRT":
      return 22;
    case "Cube":
      return 23;
    case "Exponential":
      return 24;
    case "LogSigmoid":
      return 25;
    case "Swish":
      return 26;
    case "Mish":
      return 27;
    case "ISRU":
      return 28;
    case "StdInverse":
      return 29;
    default:
      return 0;
  }
}

function neuronTypeToEnum(neuron: { type: string; squash?: string }): number {
  if (neuron.type === "constant") return 0;
  const squash = neuron.squash ?? "IDENTITY";
  if (squash === "IF") return 2;
  if (squash === "MINIMUM") return 3;
  if (squash === "MAXIMUM") return 4;
  return 1;
}

function edgeTypeToEnum(type: string | undefined): number {
  if (type === "condition") return 1;
  if (type === "positive") return 2;
  if (type === "negative") return 3;
  return 0;
}

export class WGPUInterpreterActivation {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private bindGroupLayout: GPUBindGroupLayout;
  private paramsBuffer: GPUBuffer;

  private neuronsBuffer: GPUBuffer;
  private edgesBuffer: GPUBuffer;

  private inputBuffer: GPUBuffer | null = null;
  private outputBuffer: GPUBuffer | null = null;
  private stagingBuffer: GPUBuffer | null = null;

  private currentMaxBatch = 0;

  private readonly inputCount: number;
  private readonly outputCount: number;
  private readonly neuronCount: number;
  private readonly edgeCount: number;
  private readonly config: Required<WGPUInterpreterConfig>;

  private constructor(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    bindGroupLayout: GPUBindGroupLayout,
    paramsBuffer: GPUBuffer,
    neuronsBuffer: GPUBuffer,
    edgesBuffer: GPUBuffer,
    inputCount: number,
    outputCount: number,
    neuronCount: number,
    edgeCount: number,
    config: Required<WGPUInterpreterConfig>,
  ) {
    this.device = device;
    this.pipeline = pipeline;
    this.bindGroupLayout = bindGroupLayout;
    this.paramsBuffer = paramsBuffer;
    this.neuronsBuffer = neuronsBuffer;
    this.edgesBuffer = edgesBuffer;
    this.inputCount = inputCount;
    this.outputCount = outputCount;
    this.neuronCount = neuronCount;
    this.edgeCount = edgeCount;
    this.config = config;
  }

  static async create(
    creature: Creature,
    config: WGPUInterpreterConfig = {},
  ): Promise<WGPUInterpreterActivation> {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };

    if (!navigator.gpu) {
      throw new Error("WebGPU is not available in this environment");
    }

    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter found");
    const device = await adapter.requestDevice();

    const shaderResult = makeWGSLInterpreterShader(creature, {
      workgroupSize: fullConfig.workgroupSize,
    });
    const shaderModule = device.createShaderModule({
      code: shaderResult.shaderCode,
    });

    // Create pipeline
    const pipelineDescriptor: GPUComputePipelineDescriptor = {
      layout: "auto",
      compute: { module: shaderModule, entryPoint: "main" },
    };
    const pipeline = device.createComputePipeline(pipelineDescriptor);
    const bindGroupLayout = pipeline.getBindGroupLayout(0);

    // Pack neuron + edge metadata
    const { neurons, edges } = buildInterpreterProgram(creature);

    // Params buffer (8x u32 = 32 bytes)
    const paramsBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    // Neuron buffer: struct is 32 bytes (8 * 4)
    const neuronsBuffer = device.createBuffer({
      size: Math.max(1, neurons.length) * 32,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    {
      const u32 = new Uint32Array(neuronsBuffer.getMappedRange());
      // Layout (u32 view):
      // [start, count, ntype, squash, bias_as_u32, pad, pad, pad]
      for (let i = 0; i < neurons.length; i++) {
        const base = i * 8;
        const n = neurons[i];
        u32[base + 0] = n.start >>> 0;
        u32[base + 1] = n.count >>> 0;
        u32[base + 2] = n.ntype >>> 0;
        u32[base + 3] = n.squash >>> 0;
        // Write bias via float view
      }
      const f32 = new Float32Array(neuronsBuffer.getMappedRange());
      for (let i = 0; i < neurons.length; i++) {
        const baseF = i * 8;
        f32[baseF + 4] = neurons[i].bias;
      }
      neuronsBuffer.unmap();
    }

    // Edge buffer: struct is 16 bytes (4 * 4)
    const edgesBuffer = device.createBuffer({
      size: Math.max(1, edges.length) * 16,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
      mappedAtCreation: true,
    });
    {
      const u32 = new Uint32Array(edgesBuffer.getMappedRange());
      for (let i = 0; i < edges.length; i++) {
        const base = i * 4;
        const e = edges[i];
        u32[base + 0] = e.from >>> 0;
        u32[base + 1] = e.etype >>> 0;
      }
      const f32 = new Float32Array(edgesBuffer.getMappedRange());
      for (let i = 0; i < edges.length; i++) {
        const baseF = i * 4;
        f32[baseF + 2] = edges[i].weight;
      }
      edgesBuffer.unmap();
    }

    return new WGPUInterpreterActivation(
      device,
      pipeline,
      bindGroupLayout,
      paramsBuffer,
      neuronsBuffer,
      edgesBuffer,
      shaderResult.inputCount,
      shaderResult.outputCount,
      shaderResult.neuronCount,
      shaderResult.edgeCount,
      fullConfig,
    );
  }

  dispose(): void {
    try {
      this.inputBuffer?.destroy();
      this.outputBuffer?.destroy();
      this.stagingBuffer?.destroy();
      this.paramsBuffer.destroy();
      this.neuronsBuffer.destroy();
      this.edgesBuffer.destroy();
    } catch {
      // ignore
    }
    this.inputBuffer = null;
    this.outputBuffer = null;
    this.stagingBuffer = null;
    // @ts-ignore - help GC
    this.device = null;
  }

  private ensureBuffers(batchSize: number): void {
    if (batchSize <= this.currentMaxBatch) return;
    this.inputBuffer?.destroy();
    this.outputBuffer?.destroy();
    this.stagingBuffer?.destroy();

    const inputSize = batchSize * this.inputCount * 4;
    const outputSize = batchSize * this.outputCount * 4;

    this.inputBuffer = this.device.createBuffer({
      size: inputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.outputBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.stagingBuffer = this.device.createBuffer({
      size: outputSize,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    this.currentMaxBatch = batchSize;
  }

  async activateBatch(inputs: Float32Array): Promise<Float32Array> {
    if (inputs.length === 0) return new Float32Array(0);
    if (inputs.length % this.inputCount !== 0) {
      throw new Error(
        `Input length ${inputs.length} is not divisible by inputCount ${this.inputCount}`,
      );
    }
    const batchSize = inputs.length / this.inputCount;
    if (batchSize > this.config.maxBatchSize) {
      throw new Error(
        `Batch size ${batchSize} exceeds maximum ${this.config.maxBatchSize}`,
      );
    }

    this.ensureBuffers(batchSize);

    const inputSize = inputs.byteLength;
    const outputSize = batchSize * this.outputCount * 4;

    // Deno types `inputs.buffer` as `ArrayBufferLike` (can be SharedArrayBuffer),
    // but `queue.writeBuffer` requires a `BufferSource`. We pass a normal
    // `ArrayBuffer` slice to satisfy both typing and runtime requirements.
    const inputSlice = inputs.buffer.slice(
      inputs.byteOffset,
      inputs.byteOffset + inputSize,
    ) as ArrayBuffer;
    this.device.queue.writeBuffer(this.inputBuffer!, 0, inputSlice);

    // Params (8 u32)
    const params = new Uint32Array([
      batchSize,
      this.inputCount,
      this.outputCount,
      this.neuronCount,
      this.edgeCount,
      0,
      0,
      0,
    ]);
    this.device.queue.writeBuffer(this.paramsBuffer, 0, params);

    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: { buffer: this.neuronsBuffer } },
        { binding: 2, resource: { buffer: this.edgesBuffer } },
        { binding: 3, resource: { buffer: this.inputBuffer! } },
        { binding: 4, resource: { buffer: this.outputBuffer! } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    const workgroupCount = Math.ceil(batchSize / this.config.workgroupSize);
    pass.dispatchWorkgroups(workgroupCount);
    pass.end();
    encoder.copyBufferToBuffer(
      this.outputBuffer!,
      0,
      this.stagingBuffer!,
      0,
      outputSize,
    );

    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();

    await this.stagingBuffer!.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(
      this.stagingBuffer!.getMappedRange(0, outputSize).slice(0),
    );
    this.stagingBuffer!.unmap();
    return out;
  }
}

function buildInterpreterProgram(creature: Creature): {
  neurons: NeuronRecord[];
  edges: EdgeRecord[];
} {
  const neurons: NeuronRecord[] = new Array(creature.neurons.length);
  const edges: EdgeRecord[] = [];

  for (let i = 0; i < creature.neurons.length; i++) {
    const n = creature.neurons[i];
    const ntype = neuronTypeToEnum(n);
    const squash = squashToEnum(n.squash ?? "IDENTITY");

    if (i < creature.input) {
      neurons[i] = { start: 0, count: 0, ntype: 1, squash: 0, bias: 0 };
      continue;
    }

    if (ntype === 0) {
      neurons[i] = { start: 0, count: 0, ntype, squash: 0, bias: n.bias };
      continue;
    }

    const inward = creature.inwardConnections(i).slice().sort((a, b) =>
      (a.from - b.from) || ((a.type ?? "").localeCompare(b.type ?? ""))
    );
    const start = edges.length;
    for (const s of inward) {
      edges.push({
        from: s.from,
        etype: edgeTypeToEnum(s.type),
        weight: s.weight,
      });
    }
    const count = edges.length - start;
    neurons[i] = { start, count, ntype, squash, bias: n.bias };
  }

  return { neurons, edges };
}
