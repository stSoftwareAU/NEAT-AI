import type { NativeBackpropHandle } from "@architecture/training/NativeBackpropLibrary.ts";

/** ABI-shaped in-process double, shared by synchronous and asynchronous callers. */
export function nativeBackpropDouble(options: {
  capabilities?: string;
  status: number;
  payload: string;
  completion?: Promise<void>;
}): { handle: NativeBackpropHandle; received: Record<string, unknown>[] } {
  const received: Record<string, unknown>[] = [];
  const capabilityBytes = options.capabilities === undefined
    ? null
    : new TextEncoder().encode(`${options.capabilities}\0`);
  const payload = new TextEncoder().encode(options.payload);
  let closed = false;
  const checkOpen = () => {
    if (closed) {
      throw new Error("Native code was unloaded before training returned");
    }
  };
  const writeBuffer = (out: Uint8Array): void => {
    const view = new DataView(out.buffer, out.byteOffset, out.byteLength);
    view.setBigUint64(
      0,
      Deno.UnsafePointer.value(Deno.UnsafePointer.of(payload)),
      true,
    );
    view.setBigUint64(8, BigInt(payload.byteLength), true);
    view.setBigUint64(16, BigInt(payload.byteLength), true);
  };
  const remember = (bytes: Uint8Array) =>
    received.push(JSON.parse(new TextDecoder().decode(bytes)));
  const symbols = {
    neat_backprop_abi_version: () => 1,
    neat_backprop_version: () => null,
    neat_backprop_capabilities: capabilityBytes === null
      ? null
      : () => Deno.UnsafePointer.of(capabilityBytes),
    neat_backprop_train: (bytes: Uint8Array, _len: bigint, out: Uint8Array) => {
      checkOpen();
      remember(bytes);
      writeBuffer(out);
      return options.status;
    },
    neat_backprop_train_nonblocking: (
      reqPtr: Deno.PointerObject,
      len: bigint,
      outPtr: Deno.PointerObject,
    ) => {
      const bytes = new Uint8Array(Number(len));
      new Deno.UnsafePointerView(reqPtr).copyInto(bytes);
      remember(bytes);
      writeBuffer(
        new Uint8Array(Deno.UnsafePointerView.getArrayBuffer(outPtr, 24)),
      );
      return (options.completion ?? Promise.resolve()).then(() => {
        checkOpen();
        return options.status;
      });
    },
    neat_backprop_buffer_free: checkOpen,
  };
  return {
    handle: {
      symbols,
      close: () => {
        closed = true;
      },
    } as unknown as NativeBackpropHandle,
    received,
  };
}
