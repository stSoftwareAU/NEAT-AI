import type { Creature } from "../Creature.ts";
import type { CostInterface } from "../costs/CostInterface.ts";
import { makeWGSLShader, type WGSLShaderResult } from "./MakeWGSLShader.ts";

/**
 * Configuration for WGPU activation
 */
export interface WGPUActivationConfig {
  /** Maximum batch size for GPU processing. Defaults to 4096. */
  maxBatchSize?: number;
  /** Workgroup size for compute shader. Defaults to 64. */
  workgroupSize?: number;
}

/**
 * Parameters uniform buffer structure
 */
interface ParamsBuffer {
  batchSize: number;
  inputCount: number;
  outputCount: number;
  neuronCount: number;
}

/**
 * WGPUActivation provides GPU-accelerated batched activation for creatures.
 *
 * This class generates WGSL compute shaders from the creature's neural network
 * topology and executes them on the GPU for parallel processing of multiple
 * input records.
 *
 * Usage:
 * ```typescript
 * const wgpu = await WGPUActivation.create(creature);
 * const outputs = await wgpu.activateBatch(inputs);
 * wgpu.dispose();
 * ```
 *
 * Performance considerations:
 * - Best suited for evaluation (inference) rather than training
 * - Optimal batch sizes are typically 256-4096 records
 * - Data transfer overhead means small batches may be slower than CPU
 * - The shader is compiled once and reused for all batches
 */
export class WGPUActivation {
  private device: GPUDevice;
  private pipeline: GPUComputePipeline;
  private bindGroupLayout: GPUBindGroupLayout;
  private shaderResult: WGSLShaderResult;
  private config: Required<WGPUActivationConfig>;

  // Reusable buffers
  private paramsBuffer: GPUBuffer;
  private inputBuffer: GPUBuffer | null = null;
  private outputBuffer: GPUBuffer | null = null;
  private stagingBuffer: GPUBuffer | null = null;
  private currentMaxBatch = 0;

  private constructor(
    device: GPUDevice,
    pipeline: GPUComputePipeline,
    bindGroupLayout: GPUBindGroupLayout,
    paramsBuffer: GPUBuffer,
    shaderResult: WGSLShaderResult,
    config: Required<WGPUActivationConfig>,
  ) {
    this.device = device;
    this.pipeline = pipeline;
    this.bindGroupLayout = bindGroupLayout;
    this.paramsBuffer = paramsBuffer;
    this.shaderResult = shaderResult;
    this.config = config;
  }

  /**
   * Creates a new WGPUActivation instance for the given creature.
   *
   * @param creature - The creature to create GPU activation for
   * @param config - Optional configuration
   * @returns Promise resolving to the WGPUActivation instance
   * @throws Error if WebGPU is not available or initialization fails
   */
  static async create(
    creature: Creature,
    config: WGPUActivationConfig = {},
  ): Promise<WGPUActivation> {
    const WGPU_CREATE_TIMEOUT_MS = 10_000;
    const withTimeout = async <T>(promise: Promise<T>, label: string) => {
      let timer: number | undefined;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error(label)),
            WGPU_CREATE_TIMEOUT_MS,
          );
        });
        return await Promise.race([promise, timeoutPromise]);
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      }
    };

    const fullConfig: Required<WGPUActivationConfig> = {
      maxBatchSize: config.maxBatchSize ?? 4096,
      workgroupSize: config.workgroupSize ?? 64,
    };

    // Check for WebGPU support
    if (typeof navigator === "undefined" || !navigator.gpu) {
      throw new Error(
        "WebGPU is not supported in this environment. " +
          "Ensure you are running Deno with --unstable-webgpu flag.",
      );
    }

    // Request adapter and device
    const adapter = await withTimeout(
      navigator.gpu.requestAdapter(),
      "WebGPU adapter request timed out",
    );
    if (!adapter) {
      throw new Error("Failed to get WebGPU adapter");
    }

    const device = await withTimeout(
      adapter.requestDevice(),
      "WebGPU device request timed out",
    );

    if (
      !Number.isInteger(fullConfig.workgroupSize) ||
      fullConfig.workgroupSize <= 0
    ) {
      throw new Error(
        `Invalid workgroupSize ${fullConfig.workgroupSize}. Expected a positive integer.`,
      );
    }

    const maxInvocations = device.limits.maxComputeInvocationsPerWorkgroup;
    const maxX = device.limits.maxComputeWorkgroupSizeX;
    if (
      fullConfig.workgroupSize > maxInvocations ||
      fullConfig.workgroupSize > maxX
    ) {
      throw new Error(
        `workgroupSize ${fullConfig.workgroupSize} exceeds device limits (maxInvocations=${maxInvocations}, maxWorkgroupSizeX=${maxX})`,
      );
    }

    // Generate shader code
    const shaderResult = makeWGSLShader(creature, {
      workgroupSize: fullConfig.workgroupSize,
    });

    // Guardrail: fully-unrolled shaders grow with synapse count and can become
    // too large for reliable compilation/execution on some drivers.
    // When this happens we've observed all-NaN outputs rather than a clean error.
    //
    // Keep this threshold conservative; callers should fall back to CPU when hit.
    if (shaderResult.shaderCode.length > 750_000) {
      throw new Error(
        `WGSL shader is too large (${shaderResult.shaderCode.length} chars). ` +
          "This creature is too dense for the current unrolled WebGPU path. " +
          "Reduce network density/size or use CPU activation for this creature.",
      );
    }

    // Create shader module
    const shaderModule = device.createShaderModule({
      code: shaderResult.shaderCode,
    });

    // Fail fast on shader compilation errors (avoids silent NaN outputs).
    try {
      const compilationInfo = await withTimeout(
        shaderModule.getCompilationInfo(),
        "WGSL compilation info timed out",
      );
      const errors = compilationInfo.messages.filter((m) => m.type === "error");
      if (errors.length) {
        const detail = errors.slice(0, 3).map((e) =>
          `${e.lineNum}:${e.linePos} ${e.message}`
        ).join("; ");
        throw new Error(`WGSL shader compilation failed: ${detail}`);
      }
    } catch (e) {
      // If compilation info isn't supported, we still proceed.
      // The size guard above catches the most common failure mode.
      if (
        e instanceof Error &&
        e.message.startsWith("WGSL shader compilation failed")
      ) {
        throw e;
      }
    }

    // Create compute pipeline.
    //
    // Note: In Deno's current WebGPU implementation, `createComputePipelineAsync`
    // is not reliably available/usable across environments. We therefore use the
    // synchronous API here.
    //
    // Quality gate: our `quality.sh` runs WebGPU tests in a separate process with
    // a watchdog timeout, so a driver stall here cannot hang the entire suite.
    const pipelineDescriptor: GPUComputePipelineDescriptor = {
      layout: "auto",
      compute: {
        module: shaderModule,
        entryPoint: "main",
      },
    };
    const pipeline = device.createComputePipeline(pipelineDescriptor);
    const bindGroupLayout = pipeline.getBindGroupLayout(0);

    // Create params uniform buffer
    const paramsBuffer = device.createBuffer({
      size: 16, // 4 x u32
      usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST,
    });

    return new WGPUActivation(
      device,
      pipeline,
      bindGroupLayout,
      paramsBuffer,
      shaderResult,
      fullConfig,
    );
  }

  /**
   * Gets the generated WGSL shader code for inspection/debugging
   */
  getShaderCode(): string {
    return this.shaderResult.shaderCode;
  }

  /**
   * Gets shader metadata
   */
  getShaderInfo(): WGSLShaderResult {
    return this.shaderResult;
  }

  /**
   * Ensures buffers are allocated for the given batch size
   */
  private ensureBuffers(batchSize: number): void {
    if (batchSize <= this.currentMaxBatch) {
      return;
    }

    // Clean up old buffers
    this.inputBuffer?.destroy();
    this.outputBuffer?.destroy();
    this.stagingBuffer?.destroy();

    const inputSize = batchSize * this.shaderResult.inputCount * 4;
    const outputSize = batchSize * this.shaderResult.outputCount * 4;

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

  /**
   * Activates the creature for a batch of inputs in parallel on the GPU.
   *
   * @param inputs - Float32Array of shape [batchSize * inputCount], row-major
   * @returns Promise resolving to Float32Array of shape [batchSize * outputCount]
   */
  async activateBatch(inputs: Float32Array): Promise<Float32Array> {
    const inputCount = this.shaderResult.inputCount;
    const outputCount = this.shaderResult.outputCount;
    const batchSize = Math.floor(inputs.length / inputCount);

    if (inputs.length !== batchSize * inputCount) {
      throw new Error(
        `Input length ${inputs.length} is not divisible by input count ${inputCount}`,
      );
    }

    if (batchSize === 0) {
      // Empty batch is valid: return an empty output array and avoid touching GPU buffers.
      return new Float32Array(0);
    }

    if (batchSize > this.config.maxBatchSize) {
      throw new Error(
        `Batch size ${batchSize} exceeds maximum ${this.config.maxBatchSize}`,
      );
    }

    // Ensure buffers are allocated
    this.ensureBuffers(batchSize);

    // Write params
    const params = new Uint32Array([
      batchSize,
      inputCount,
      outputCount,
      this.shaderResult.neuronCount,
    ]);
    this.device.queue.writeBuffer(
      this.paramsBuffer,
      0,
      params.buffer as ArrayBuffer,
    );

    // Write inputs
    this.device.queue.writeBuffer(
      this.inputBuffer!,
      0,
      inputs.buffer as ArrayBuffer,
      inputs.byteOffset,
      inputs.byteLength,
    );

    // Create bind group
    const bindGroup = this.device.createBindGroup({
      layout: this.bindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.paramsBuffer } },
        { binding: 1, resource: { buffer: this.inputBuffer! } },
        { binding: 2, resource: { buffer: this.outputBuffer! } },
      ],
    });

    // Create command encoder
    const commandEncoder = this.device.createCommandEncoder();

    // Dispatch compute shader
    const computePass = commandEncoder.beginComputePass();
    computePass.setPipeline(this.pipeline);
    computePass.setBindGroup(0, bindGroup);

    const workgroupCount = Math.ceil(batchSize / this.config.workgroupSize);
    computePass.dispatchWorkgroups(workgroupCount);
    computePass.end();

    // Copy output to staging buffer
    const outputSize = batchSize * outputCount * 4;
    commandEncoder.copyBufferToBuffer(
      this.outputBuffer!,
      0,
      this.stagingBuffer!,
      0,
      outputSize,
    );

    // Submit commands
    this.device.pushErrorScope("validation");
    let errorScopePopped = false;
    const WGPU_TIMEOUT_MS = 30_000;
    const withTimeout = async <T>(
      promise: Promise<T>,
      label: string,
    ): Promise<T> => {
      let timer: number | undefined;
      try {
        const timeoutPromise = new Promise<never>((_, reject) => {
          timer = setTimeout(() => reject(new Error(label)), WGPU_TIMEOUT_MS);
        });
        return await Promise.race([promise, timeoutPromise]);
      } finally {
        if (timer !== undefined) {
          clearTimeout(timer);
        }
      }
    };

    try {
      this.device.queue.submit([commandEncoder.finish()]);

      await withTimeout(
        this.device.queue.onSubmittedWorkDone(),
        "WebGPU queue submission timed out",
      );

      const validationError = await withTimeout(
        this.device.popErrorScope(),
        "WebGPU validation error scope timed out",
      );
      errorScopePopped = true;

      if (validationError) {
        throw new Error(`WebGPU validation error: ${validationError.message}`);
      }
    } finally {
      // Best-effort: keep the device error scope stack balanced even when a timeout happens.
      if (!errorScopePopped) {
        try {
          await withTimeout(
            this.device.popErrorScope(),
            "WebGPU validation error scope cleanup timed out",
          );
        } catch {
          // ignore
        }
      }
    }

    // Read back results
    await withTimeout(
      this.stagingBuffer!.mapAsync(GPUMapMode.READ),
      "WebGPU mapAsync timed out",
    );
    const outputData = new Float32Array(
      this.stagingBuffer!.getMappedRange(0, outputSize).slice(0),
    );
    this.stagingBuffer!.unmap();

    return outputData;
  }

  /**
   * Activates a single input through the GPU.
   * For single inputs, CPU activation is typically faster due to transfer overhead.
   *
   * @param input - Float32Array of input values
   * @returns Promise resolving to Float32Array of output values
   */
  async activate(input: Float32Array): Promise<Float32Array> {
    const outputs = await this.activateBatch(input);
    return outputs;
  }

  /**
   * Evaluates the creature on a dataset using GPU-accelerated batched activation.
   *
   * @param inputs - Array of input Float32Arrays or a single batched Float32Array
   * @param targets - Array of target Float32Arrays or a single batched Float32Array
   * @param cost - Cost function to calculate error
   * @returns Average error across all samples
   */
  async evaluateBatch(
    inputs: Float32Array,
    targets: Float32Array,
    cost: CostInterface,
  ): Promise<number> {
    const inputCount = this.shaderResult.inputCount;
    const outputCount = this.shaderResult.outputCount;
    const batchSize = Math.floor(inputs.length / inputCount);

    if (inputs.length !== batchSize * inputCount) {
      throw new Error(
        `Inputs length ${inputs.length} is not divisible by input count ${inputCount}`,
      );
    }

    if (batchSize === 0) {
      if (targets.length !== 0) {
        throw new Error(
          `Targets length ${targets.length} does not match expected 0 for empty inputs`,
        );
      }
      return 0;
    }

    const expectedTargets = batchSize * outputCount;
    if (targets.length !== expectedTargets) {
      throw new Error(
        `Targets length ${targets.length} does not match expected ${expectedTargets} (batchSize=${batchSize}, outputCount=${outputCount})`,
      );
    }

    // Activate all inputs
    const outputs = await this.activateBatch(inputs);

    // Calculate error for each sample
    let totalError = 0;
    for (let i = 0; i < batchSize; i++) {
      const outputStart = i * outputCount;
      const actualSlice = outputs.subarray(
        outputStart,
        outputStart + outputCount,
      );
      const targetSlice = targets.subarray(
        outputStart,
        outputStart + outputCount,
      );
      totalError += cost.calculate(targetSlice, actualSlice);
    }

    return totalError / batchSize;
  }

  /**
   * Processes large datasets in chunks, handling batch size limits automatically.
   *
   * @param inputs - Complete input dataset as Float32Array
   * @param targets - Complete target dataset as Float32Array
   * @param cost - Cost function to calculate error
   * @param batchSize - Size of each batch (defaults to maxBatchSize)
   * @returns Average error across all samples
   */
  async evaluateChunked(
    inputs: Float32Array,
    targets: Float32Array,
    cost: CostInterface,
    batchSize?: number,
  ): Promise<number> {
    const inputCount = this.shaderResult.inputCount;
    const outputCount = this.shaderResult.outputCount;

    if (inputs.length === 0) {
      // No samples: return a sensible result rather than NaN.
      return 0;
    }

    if (inputs.length < inputCount) {
      throw new Error(
        `Inputs length ${inputs.length} is smaller than input count ${inputCount}`,
      );
    }

    if (inputs.length % inputCount !== 0) {
      throw new Error(
        `Inputs length ${inputs.length} is not divisible by input count ${inputCount}`,
      );
    }

    const totalSamples = inputs.length / inputCount;
    const expectedTargets = totalSamples * outputCount;
    if (targets.length !== expectedTargets) {
      throw new Error(
        `Targets length ${targets.length} does not match expected ${expectedTargets} (samples=${totalSamples}, outputCount=${outputCount})`,
      );
    }

    const chunkSize = batchSize ?? this.config.maxBatchSize;

    let totalError = 0;
    let processedSamples = 0;

    for (let offset = 0; offset < totalSamples; offset += chunkSize) {
      const currentBatchSize = Math.min(chunkSize, totalSamples - offset);

      const inputStart = offset * inputCount;
      const inputEnd = inputStart + currentBatchSize * inputCount;
      const batchInputs = inputs.subarray(inputStart, inputEnd);

      const targetStart = offset * outputCount;
      const targetEnd = targetStart + currentBatchSize * outputCount;
      const batchTargets = targets.subarray(targetStart, targetEnd);

      // deno-lint-ignore no-await-in-loop -- Sequential GPU processing is intentional; GPU can only handle one batch at a time
      const batchError = await this.evaluateBatch(
        batchInputs,
        batchTargets,
        cost,
      );
      totalError += batchError * currentBatchSize;
      processedSamples += currentBatchSize;
    }

    if (processedSamples === 0) {
      // Defensive guard: callers should never get NaN due to a 0/0.
      return 0;
    }

    return totalError / processedSamples;
  }

  /**
   * Releases all GPU resources.
   * Call this when done with the instance to free GPU memory.
   */
  dispose(): void {
    this.paramsBuffer.destroy();
    this.inputBuffer?.destroy();
    this.outputBuffer?.destroy();
    this.stagingBuffer?.destroy();
    this.device.destroy();
  }
}
