import { assert, assertEquals } from "@std/assert";
import { stub } from "@std/testing/mock";
import { join } from "@std/path/join";
import {
  closeRustLibrary,
  recordDiscovery,
} from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";
import type { RustRecordInput } from "../../src/architecture/ErrorGuidedStructuralEvolution/RustDiscovery.ts";

Deno.test("recordDiscovery handles stringify failure before encoding", () => {
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
      read_discovery_records_ffi: () => {
        throw new Error("read_discovery_records_ffi should not be invoked");
      },
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
    const invalidInput: RustRecordInput = {
      creature: {
        neurons: [],
        synapses: [],
        input: 1,
        output: 1,
      },
      "training_data": [{
        input: [
          BigInt(1) as unknown as number,
        ],
        output: [0],
      }],
      "temp_dir": "/virtual/discovery",
    };

    const result = recordDiscovery(invalidInput);
    assert(result, "recordDiscovery should return a failure result");
    assertEquals(result.success, false);
    assert(result.errorDetails, "error details should be supplied");
    assertEquals(result.errorDetails.stage, "stringify");
    assertEquals(result.error, "Do not know how to serialize a BigInt");
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
});
