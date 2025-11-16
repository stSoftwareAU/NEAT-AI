# GPU Acceleration for Discovery on macOS

## Overview

The NEAT-AI Discovery Rust library **already supports GPU acceleration** on macOS using Metal via the `wgpu` crate. GPU acceleration is automatically enabled for Mac systems (`darwin`) and uses Metal under the hood for high-performance compute operations.

## Current GPU Implementation

### What's Already GPU-Accelerated

1. **Synapse Analysis** - Both helpful and harmful synapse evaluation use GPU compute shaders
2. **Neuron Analysis** - The helpful statistics calculation uses GPU, though activation function evaluation still runs on CPU

### GPU Technology Stack

- **wgpu 0.19** - Cross-platform GPU abstraction layer
- **Metal** - Apple's GPU API (used automatically on macOS)
- **Compute Shaders** - WGSL shaders for parallel processing

## Verifying GPU Usage

### Method 1: Check Logs

When discovery runs with logging enabled, you'll now see messages like:

```
Rust synapse analysis using GPU (X helpful, Y harmful candidates)
Rust neuron analysis using GPU (Z candidates)
```

If you see "using CPU fallback" instead, the GPU failed to initialise.

### Method 2: Enable Debug Mode

Set the environment variable to see detailed GPU diagnostics:

```bash
export NEAT_AI_DISCOVERY_GPU_DEBUG=1
```

This will print:
- GPU adapter information
- Device initialisation status
- Any fallback to CPU

### Method 3: Check Return Values

The Rust analysis functions return a `gpuUsed` boolean field indicating whether GPU was actually used:

```typescript
const result = analyzeSynapses(input);
if (result.gpuUsed) {
  console.log("GPU acceleration is active!");
} else {
  console.warn("Falling back to CPU - check GPU availability");
}
```

## Performance Considerations

### GPU Utilization Improvements (2 Jan 2025)

The code now batches multiple GPU operations together to improve utilization:

- **Batched Evaluation**: Multiple synapse evaluations are collected and submitted together in batches of 32
- **Better GPU Saturation**: Instead of submitting one operation at a time and waiting, multiple operations are queued before waiting
- **Reduced Idle Time**: GPU spends less time waiting for CPU to prepare the next operation

### Why It Might Still Be Slow

Even with GPU acceleration, discovery can be CPU-bound due to:

1. **Data I/O** - Reading Parquet files and preparing data for GPU
2. **Neuron Analysis** - Activation function evaluation (GELU, ELU, SELU, etc.) still runs on CPU
3. **Memory Transfers** - Copying data between CPU and GPU memory
4. **Small Workloads** - GPU overhead may not be worth it for small datasets

### Current GPU Usage

The implementation uses GPU for:
- ✅ Helpful synapse statistics (batched parallel evaluation)
- ✅ Harmful synapse statistics (parallel evaluation)
- ❌ Neuron activation function evaluation (still CPU-bound)

### Future Optimisation Opportunities

- Move activation function evaluation to GPU
- Batch harmful synapse evaluations as well
- Optimise memory transfers with buffer reuse
- Use async GPU execution to overlap CPU/GPU work

## Troubleshooting

### GPU Not Being Used

If you see "using CPU fallback" in logs:

1. **Check Metal Support**: Ensure your Mac supports Metal (all modern Macs do)
2. **Check Permissions**: Some systems may require GPU access permissions
3. **Check wgpu Version**: Ensure `wgpu = "0.19"` in `Cargo.toml`
4. **Rebuild**: After updating Rust code, rebuild the library:
   ```bash
   cd NEAT-AI-Discovery
   cargo build --release
   ```

### Performance Issues

If GPU is active but still slow:

1. **Check Dataset Size**: GPU benefits increase with larger datasets
2. **Monitor GPU Usage**: Use Activity Monitor or `gpuStats` to verify GPU is being utilised
3. **Check Other Bottlenecks**: Parquet I/O, TypeScript processing, etc.

## Configuration

### Requiring GPU (Default on Mac)

On macOS, GPU is required by default:

```typescript
requireGpu: Deno.build.os === "darwin"  // true on Mac
```

If GPU initialisation fails and `requireGpu` is true, discovery will fail with an error. If false, it falls back to CPU.

### Disabling GPU Requirement

To allow CPU fallback even on Mac:

```typescript
requireGpu: false  // Will use GPU if available, but fall back to CPU
```

## Technical Details

### GPU Compute Shaders

The GPU uses two compute shaders:

1. **Helpful Synapse Shader** - Evaluates which synapses would help reduce error
2. **Harmful Synapse Shader** - Evaluates which existing synapses are harmful

Both use workgroup size of 256 threads for parallel processing.

### Memory Layout

Data is transferred to GPU as:
- `GpuHelpfulSample` - Activation and error pairs
- Results returned as `HelpfulContribution` or `HarmfulContribution`

## Date

2 Jan 2025

