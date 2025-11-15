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
  name: "readDiscoveryRecords accepts large JSON payloads from Rust",
  ignore: !hasFfiPermission,
  fn() {
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

    const records = new Array(24000).fill(0).map((_index, i) => ({
      obs_index: i,
      neuron_uuid: `neuron-${i}`,
      value: Math.sin(i),
      activation: Math.cos(i),
      errors: [Math.tanh(i)],
    }));
    const largeResult: RustReadResult = {
      success: true,
      records,
    };
    const json = JSON.stringify(largeResult);
    assert(
      json.length > 1_200_000,
      "Test payload should exceed previous 1 MB decode limit",
    );

    const bytes = new TextEncoder().encode(json);
    const buffer = new Uint8Array(bytes.length + 1);
    buffer.set(bytes);
    buffer[bytes.length] = 0;
    const resultPtr = Deno.UnsafePointer.of(buffer);
    if (resultPtr === null) {
      throw new Error("Failed to allocate result pointer for test");
    }

    const fakeLib = {
      symbols: {
        record_discovery: () => {
          throw new Error("record_discovery should not be called");
        },
        analyze_synapses: () => {
          throw new Error("analyze_synapses should not be called");
        },
        analyze_neurons: () => {
          throw new Error("analyze_neurons should not be called");
        },
        read_discovery_records_ffi: () => resultPtr,
        merge_discovery_parquet: () => {
          throw new Error("merge_discovery_parquet should not be called");
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
    const envGetStub = stub(
      Deno.env,
      "get",
      (key: string) =>
        key === "NEAT_AI_DISCOVERY_LIB_PATH" ? fakeLibPath : undefined,
    );
    const envSetStub = stub(Deno.env, "set");

    try {
      const result = readDiscoveryRecords(
        {
          parquet_file: "/tmp/fake.parquet",
          neuron_uuid: "neuron-0",
        } satisfies RustReadInput,
      );
      assert(result, "readDiscoveryRecords should return a result");
      assertEquals(result.success, true);
      assert(result.records);
      assertEquals(result.records.length, records.length);
    } finally {
      closeRustLibrary();
      dlopenStub.restore();
      statStub.restore();
      permissionsStub.restore();
      envGetStub.restore();
      envSetStub.restore();
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
