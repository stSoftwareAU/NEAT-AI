import { Creature } from "../Creature.ts";
import { WGPUActivation } from "./WGPUActivation.ts";

type InitMsg = {
  type: "init";
  creatureJSON: unknown;
};

type ActivateMsg = {
  type: "activate";
  id: number;
  inputs: ArrayBuffer;
};

type DisposeMsg = {
  type: "dispose";
};

type MsgFromMain = InitMsg | ActivateMsg | DisposeMsg;

type ReadyMsg = { type: "ready"; inputCount: number; outputCount: number };
type ResultMsg = { type: "result"; id: number; outputs: ArrayBuffer };
type ErrorMsg = { type: "error"; id?: number; message: string };

let wgpu: WGPUActivation | null = null;

type WorkerScope = {
  onmessage:
    | ((ev: MessageEvent<MsgFromMain>) => void | Promise<void>)
    | null;
  postMessage: (
    message: unknown,
    transferOrOptions?: Transferable[] | StructuredSerializeOptions,
  ) => void;
  close: () => void;
};

const ctx = self as unknown as WorkerScope;

ctx.onmessage = async (ev: MessageEvent<MsgFromMain>) => {
  const msg = ev.data;

  try {
    if (msg.type === "init") {
      const creature = Creature.fromJSON(msg.creatureJSON as never);
      wgpu?.dispose();
      wgpu = await WGPUActivation.create(creature);
      creature.dispose();

      // Tell the parent what shapes we expect.
      const info = wgpu.getShaderInfo();
      const ready: ReadyMsg = {
        type: "ready",
        inputCount: info.inputCount,
        outputCount: info.outputCount,
      };
      ctx.postMessage(ready);
      return;
    }

    if (msg.type === "activate") {
      if (!wgpu) {
        const err: ErrorMsg = {
          type: "error",
          id: msg.id,
          message: "Not initialised",
        };
        ctx.postMessage(err);
        return;
      }

      const inputs = new Float32Array(msg.inputs);
      const outputs = await wgpu.activateBatch(inputs);

      const outBuf = outputs.slice().buffer;

      const res: ResultMsg = { type: "result", id: msg.id, outputs: outBuf };
      ctx.postMessage(res, { transfer: [outBuf] });
      return;
    }

    if (msg.type === "dispose") {
      wgpu?.dispose();
      wgpu = null;
      self.close();
      return;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    const err: ErrorMsg = {
      type: "error",
      id: (msg as ActivateMsg).id,
      message,
    };
    ctx.postMessage(err);
  }
};
