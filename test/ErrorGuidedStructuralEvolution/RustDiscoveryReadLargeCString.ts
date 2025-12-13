import { assert, assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { join } from "@std/path/join";
import {
  closeRustLibrary,
  readDiscoveryRecords,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import type {
  RustReadInput,
  RustReadResult,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

const hasFfiPermission = (() => {
  try {
    if (typeof Deno.permissions?.querySync !== "function") {
      return false;
    }
    const status = Deno.permissions.querySync({ name: "ffi" });
    return status.state === "granted";
  } catch {
    return false;
  }
})();

Deno.test({
  name: "readDiscoveryRecords handles large JSON payloads from Rust",
  ignore: !hasFfiPermission,
  fn: () => {
    closeRustLibrary();

    const extension = (() => {
      switch (Deno.build.os) {
        case "darwin":
          return ".dylib";
        case "linux":
          return ".so";
        case "windows":
          return ".dll";
        default:
          return ".dylib";
      }
    })();
    const fakeLibPath = join("/virtual", `libneat_ai_discovery${extension}`);

    const fakeFileInfo: Deno.FileInfo = {
      isFile: true,
      isDirectory: false,
      isSymlink: false,
      isBlockDevice: false,
      isCharDevice: false,
      isFifo: false,
      isSocket: false,
      size: 0,
      mtime: null,
      atime: null,
      birthtime: null,
      ctime: null,
      dev: 0,
      ino: 0,
      mode: 0,
      nlink: 0,
      blksize: 0,
      blocks: 0,
      uid: 0,
      gid: 0,
      rdev: 0,
    };

    const encoder = new TextEncoder();
    const records = Array.from({ length: 60_000 }, (_, index) => ({
      obs_index: index,
      neuron_uuid: `neuron-${index}`,
      value: index * 0.5,
      activation: index * 0.25,
      errors: [index % 3 === 0 ? -0.5 : 0.25],
    }));
    const largeResult: RustReadResult = {
      success: true,
      records,
    };
    const payload = JSON.stringify(largeResult);
    const payloadBytes = encoder.encode(payload);
    const payloadBuffer = new Uint8Array(payloadBytes.length + 1);
    payloadBuffer.set(payloadBytes);
    payloadBuffer[payloadBytes.length] = 0;
    const payloadPointer = Deno.UnsafePointer.of(payloadBuffer);

    const fakeLib = {
      symbols: {
        record_discovery: () => {
          throw new Error("record_discovery should not be invoked");
        },
        analyze_synapses: () => {
          throw new Error("analyze_synapses should not be invoked");
        },
        analyze_neurons: () => {
          throw new Error("analyze_neurons should not be invoked");
        },
        read_discovery_records_ffi: () => payloadPointer,
        merge_discovery_parquet: () => {
          throw new Error("merge_discovery_parquet should not be invoked");
        },
        free_discovery_result: () => {},
      },
      close: () => {},
    } as unknown as Deno.DynamicLibrary<
      {
        record_discovery: { parameters: ["pointer"]; result: "pointer" };
        analyze_synapses: { parameters: ["pointer"]; result: "pointer" };
        analyze_neurons: { parameters: ["pointer"]; result: "pointer" };
        read_discovery_records_ffi: {
          parameters: ["pointer"];
          result: "pointer";
        };
        merge_discovery_parquet: { parameters: ["pointer"]; result: "pointer" };
        free_discovery_result: { parameters: ["pointer"]; result: "void" };
      }
    >;

    const originalOverride = (() => {
      try {
        return Deno.env.get("NEAT_AI_DISCOVERY_LIB_PATH");
      } catch {
        return undefined;
      }
    })();

    const dlopenStub = stub(Deno, "dlopen", () => fakeLib);
    const statStub = stub(
      Deno,
      "statSync",
      (_path: string | URL) => fakeFileInfo,
    );
    const permissionsStub = stub(
      Deno.permissions,
      "querySync",
      (_desc: Deno.PermissionDescriptor) =>
        ({
          state: "granted",
        }) as Deno.PermissionStatus,
    );
    const envStub = stub(
      Deno.env,
      "get",
      (key: string) =>
        key === "NEAT_AI_DISCOVERY_LIB_PATH" ? fakeLibPath : undefined,
    );

    try {
      const input: RustReadInput = {
        "parquet_file": "/virtual/chunk.parquet",
        "neuron_uuid": "neuron-123",
      };

      const result = readDiscoveryRecords(input);
      assert(result, "readDiscoveryRecords should return a result");
      assertEquals(result.success, true);
      assert(result.records, "records should be provided");
      assertEquals(result.records.length, records.length);
    } finally {
      closeRustLibrary();
      dlopenStub.restore();
      statStub.restore();
      permissionsStub.restore();
      envStub.restore();
      if (originalOverride !== undefined) {
        try {
          Deno.env.set("NEAT_AI_DISCOVERY_LIB_PATH", originalOverride);
        } catch {
          // Ignore environments without --allow-env.
        }
      }
    }
  },
});
