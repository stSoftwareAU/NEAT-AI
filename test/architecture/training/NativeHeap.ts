import { assertEquals, assertThrows } from "@std/assert";
import {
  allocNativeCopy,
  allocNativeZeroed,
  freeNative,
} from "@architecture/training/NativeHeap.ts";

Deno.test("native training buffers own a copy independent of the source ArrayBuffer", () => {
  const source = new Uint8Array([7, 11, 13]);
  const pointer = allocNativeCopy(source);
  try {
    source.fill(0);
    const copied = new Uint8Array(3);
    new Deno.UnsafePointerView(pointer).copyInto(copied);
    assertEquals(copied, new Uint8Array([7, 11, 13]));
  } finally {
    freeNative(pointer);
  }
});

Deno.test("native output buffers start zeroed and reject invalid lengths", () => {
  for (const length of [0, -1, 0.5, NaN, Infinity]) {
    assertThrows(
      () => allocNativeZeroed(length),
      Error,
      "byteLength must be a positive integer",
    );
  }
  const pointer = allocNativeZeroed(3);
  try {
    const bytes = new Uint8Array(3);
    new Deno.UnsafePointerView(pointer).copyInto(bytes);
    assertEquals(bytes, new Uint8Array([0, 0, 0]));
  } finally {
    freeNative(pointer);
  }
});
