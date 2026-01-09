import type { Creature } from "../Creature.ts";
import { makeWGSLInterleavedMSEShader } from "./MakeWGSLInterleavedMSEShader.ts";

type Config = {
  workgroupSize?: number;
  maxRecords?: number;
};

const DEFAULT_CONFIG: Required<Config> = {
  workgroupSize: 64,
  // Larger batches reduce GPU dispatch overhead and improve throughput when
  // scoring large datasets.
  maxRecords: 32_768,
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

function squashToEnum(name: string): number {
  // Must match WGSL switch table in MakeWGSLInterleavedMSEShader.ts
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

function buildProgram(
  creature: Creature,
): { neurons: NeuronRecord[]; edges: EdgeRecord[] } {
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

export class WGPUInterleavedMSE {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private bindGroupLayout: GPUBindGroupLayout;
  private paramsBuffer: GPUBuffer;
  private neuronsBuffer: GPUBuffer;
  private edgesBuffer: GPUBuffer;

  private recordsBuffer: GPUBuffer | null = null;
  private mseBuffer: GPUBuffer | null = null;
  private stagingBuffer: GPUBuffer | null = null;
  private currentMaxRecords = 0;

  private readonly inputCount: number;
  private readonly outputCount: number;
  private readonly neuronCount: number;
  private readonly edgeCount: number;
  private readonly config: Required<Config>;

  private constructor(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    bindGroupLayout: GPUBindGroupLayout,
    paramsBuffer: GPUBuffer,
    neuronsBuffer: GPUBuffer,
    edgesBuffer: GPUBuffer,
    counts: {
      inputCount: number;
      outputCount: number;
      neuronCount: number;
      edgeCount: number;
    },
    config: Required<Config>,
  ) {
    this.device = device;
    this.pipeline = pipeline;
    this.bindGroupLayout = bindGroupLayout;
    this.paramsBuffer = paramsBuffer;
    this.neuronsBuffer = neuronsBuffer;
    this.edgesBuffer = edgesBuffer;
    this.inputCount = counts.inputCount;
    this.outputCount = counts.outputCount;
    this.neuronCount = counts.neuronCount;
    this.edgeCount = counts.edgeCount;
    this.config = config;
  }

  static async create(
    creature: Creature,
    config: Config = {},
  ): Promise<WGPUInterleavedMSE> {
    const fullConfig = { ...DEFAULT_CONFIG, ...config };
    if (!navigator.gpu) {
      throw new Error("WebGPU is not available in this environment");
    }
    const adapter = await navigator.gpu.requestAdapter();
    if (!adapter) throw new Error("No WebGPU adapter found");
    const device = await adapter.requestDevice();

    const { shaderCode } = makeWGSLInterleavedMSEShader(creature, {
      workgroupSize: fullConfig.workgroupSize,
    });
    const shaderModule = device.createShaderModule({ code: shaderCode });
    const pipeline = device.createComputePipeline({
      layout: "auto",
      compute: { module: shaderModule, entryPoint: "main" },
    });
    const bindGroupLayout = pipeline.getBindGroupLayout(0);

    const { neurons, edges } = buildProgram(creature);
    const paramsBuffer = device.createBuffer({
      size: 32,
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    const neuronsBuffer = device.createBuffer({
      size: Math.max(1, neurons.length) * 32,
      usage: GPUBufferUsage.STORAGE,
      mappedAtCreation: true,
    });
    {
      const u32 = new Uint32Array(neuronsBuffer.getMappedRange());
      for (let i = 0; i < neurons.length; i++) {
        const base = i * 8;
        const n = neurons[i];
        u32[base + 0] = n.start >>> 0;
        u32[base + 1] = n.count >>> 0;
        u32[base + 2] = n.ntype >>> 0;
        u32[base + 3] = n.squash >>> 0;
      }
      const f32 = new Float32Array(neuronsBuffer.getMappedRange());
      for (let i = 0; i < neurons.length; i++) {
        const baseF = i * 8;
        f32[baseF + 4] = neurons[i].bias;
      }
      neuronsBuffer.unmap();
    }

    const edgesBuffer = device.createBuffer({
      size: Math.max(1, edges.length) * 16,
      usage: GPUBufferUsage.STORAGE,
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

    return new WGPUInterleavedMSE(
      device,
      pipeline,
      bindGroupLayout,
      paramsBuffer,
      neuronsBuffer,
      edgesBuffer,
      {
        inputCount: creature.input,
        outputCount: creature.output,
        neuronCount: creature.neurons.length,
        edgeCount: edges.length,
      },
      fullConfig,
    );
  }

  dispose(): void {
    try {
      this.recordsBuffer?.destroy();
      this.mseBuffer?.destroy();
      this.stagingBuffer?.destroy();
      this.paramsBuffer.destroy();
      this.neuronsBuffer.destroy();
      this.edgesBuffer.destroy();
    } catch {
      // ignore
    }
    this.recordsBuffer = null;
    this.mseBuffer = null;
    this.stagingBuffer = null;
    // @ts-ignore - help GC
    this.device = null;
  }

  private ensureBuffers(maxRecords: number, valuesCount: number): void {
    if (maxRecords <= this.currentMaxRecords) return;
    this.recordsBuffer?.destroy();
    this.mseBuffer?.destroy();
    this.stagingBuffer?.destroy();

    const recordsBytes = maxRecords * valuesCount * 4;
    const mseBytes = maxRecords * 4;

    this.recordsBuffer = this.device.createBuffer({
      size: recordsBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST,
    });
    this.mseBuffer = this.device.createBuffer({
      size: mseBytes,
      usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_SRC,
    });
    this.stagingBuffer = this.device.createBuffer({
      size: mseBytes,
      usage: GPUBufferUsage.MAP_READ | GPUBufferUsage.COPY_DST,
    });

    this.currentMaxRecords = maxRecords;
  }

  async evaluateInterleaved(
    interleaved: Float32Array,
    recordCount: number,
    valuesCount: number,
  ): Promise<Float32Array> {
    if (recordCount === 0) return new Float32Array(0);
    if (recordCount > this.config.maxRecords) {
      throw new Error(
        `recordCount ${recordCount} exceeds maxRecords ${this.config.maxRecords}`,
      );
    }
    if (valuesCount !== this.inputCount + this.outputCount) {
      throw new Error(
        `valuesCount ${valuesCount} must equal input+output (${
          this.inputCount + this.outputCount
        })`,
      );
    }

    const expectedLen = recordCount * valuesCount;
    if (interleaved.length < expectedLen) {
      throw new Error(
        `Interleaved length ${interleaved.length} is shorter than expected ${expectedLen}`,
      );
    }

    this.ensureBuffers(this.config.maxRecords, valuesCount);

    const bytes = expectedLen * 4;
    const slice = interleaved.buffer.slice(
      interleaved.byteOffset,
      interleaved.byteOffset + bytes,
    ) as ArrayBuffer;
    this.device.queue.writeBuffer(this.recordsBuffer!, 0, slice);

    const params = new Uint32Array([
      recordCount,
      this.inputCount,
      this.outputCount,
      this.neuronCount,
      this.edgeCount,
      valuesCount,
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
        { binding: 3, resource: { buffer: this.recordsBuffer! } },
        { binding: 4, resource: { buffer: this.mseBuffer! } },
      ],
    });

    const encoder = this.device.createCommandEncoder();
    const pass = encoder.beginComputePass();
    pass.setPipeline(this.pipeline);
    pass.setBindGroup(0, bindGroup);
    const workgroups = Math.ceil(recordCount / this.config.workgroupSize);
    pass.dispatchWorkgroups(workgroups);
    pass.end();

    encoder.copyBufferToBuffer(
      this.mseBuffer!,
      0,
      this.stagingBuffer!,
      0,
      recordCount * 4,
    );

    this.device.queue.submit([encoder.finish()]);
    await this.device.queue.onSubmittedWorkDone();

    await this.stagingBuffer!.mapAsync(GPUMapMode.READ);
    const out = new Float32Array(
      this.stagingBuffer!.getMappedRange(0, recordCount * 4).slice(0),
    );
    this.stagingBuffer!.unmap();
    return out;
  }
}
