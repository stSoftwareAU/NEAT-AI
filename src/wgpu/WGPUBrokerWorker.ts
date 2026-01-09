import { Creature } from "../Creature.ts";
import { WGPUInterpreterActivation } from "./WGPUInterpreterActivation.ts";
import { WGPUInterleavedMSE } from "./WGPUInterleavedMSE.ts";

type ConnectMsg = { type: "connect"; port: MessagePort };

type InitCreatureMsg = {
  type: "init";
  requestId: number;
  creatureKey: string;
  creatureJSON: unknown;
};

type ActivateMsg = {
  type: "activate";
  requestId: number;
  creatureKey: string;
  inputs: ArrayBuffer;
};

type EvaluateMSEMsg = {
  type: "evaluate-mse";
  requestId: number;
  creatureKey: string;
  // Interleaved [inputs..., targets...] records, length = recordCount * valuesCount.
  records: ArrayBuffer;
  recordCount: number;
  valuesCount: number;
};

type ClientMsg = InitCreatureMsg | ActivateMsg | EvaluateMSEMsg;

type OkMsg = { type: "ok"; requestId: number };
type ActivateResultMsg = {
  type: "activate-result";
  requestId: number;
  outputs: ArrayBuffer;
};
type EvaluateMSEResultMsg = {
  type: "evaluate-mse-result";
  requestId: number;
  totalError: number;
};
type ErrorMsg = { type: "error"; requestId: number; message: string };

type CacheEntry = {
  wgpu: WGPUInterpreterActivation;
  mse: WGPUInterleavedMSE;
};

const MAX_CACHE_ENTRIES = 64;
const cache = new Map<string, CacheEntry>();

// Serialise all WebGPU work through a single queue to avoid driver/runtime
// re-entrancy issues when many workers submit concurrently.
let gpuQueue: Promise<void> = Promise.resolve();

function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = async () => await fn();
  const p = gpuQueue.then(run, run);
  gpuQueue = p.then(() => undefined, () => undefined);
  return p;
}

async function getOrCreate(creatureKey: string, creatureJSON: unknown) {
  const existing = cache.get(creatureKey);
  if (existing) return existing;

  // Keep cache bounded (FIFO).
  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = cache.keys().next().value as string | undefined;
    if (oldestKey) {
      const oldest = cache.get(oldestKey);
      oldest?.wgpu.dispose();
      oldest?.mse.dispose();
      cache.delete(oldestKey);
    }
  }

  const creature = Creature.fromJSON(creatureJSON as never);
  try {
    const wgpu = await WGPUInterpreterActivation.create(creature);
    const mse = await WGPUInterleavedMSE.create(creature);
    const entry = { wgpu, mse };
    cache.set(creatureKey, entry);
    return entry;
  } finally {
    creature.dispose();
  }
}

function reply(
  port: MessagePort,
  msg: OkMsg | ActivateResultMsg | EvaluateMSEResultMsg | ErrorMsg,
) {
  if (msg.type === "activate-result") {
    port.postMessage(msg, { transfer: [msg.outputs] });
  } else if (msg.type === "evaluate-mse-result") {
    port.postMessage(msg);
  } else {
    port.postMessage(msg);
  }
}

async function handleClientMessage(port: MessagePort, msg: ClientMsg) {
  if (msg.type === "init") {
    await enqueue(async () => {
      await getOrCreate(msg.creatureKey, msg.creatureJSON);
    });
    reply(port, { type: "ok", requestId: msg.requestId });
    return;
  }

  if (msg.type === "activate") {
    const outputs = await enqueue(async () => {
      const entry = cache.get(msg.creatureKey);
      if (!entry) {
        throw new Error(
          `Creature '${msg.creatureKey}' not initialised in broker`,
        );
      }
      const inputs = new Float32Array(msg.inputs);
      const out = await entry.wgpu.activateBatch(inputs);
      return out.slice().buffer;
    });

    reply(port, {
      type: "activate-result",
      requestId: msg.requestId,
      outputs,
    });
    return;
  }

  if (msg.type === "evaluate-mse") {
    const totalError = await enqueue(async () => {
      const entry = cache.get(msg.creatureKey);
      if (!entry) {
        throw new Error(
          `Creature '${msg.creatureKey}' not initialised in broker`,
        );
      }
      const records = new Float32Array(msg.records);
      return await entry.mse.evaluateInterleaved(
        records,
        msg.recordCount,
        msg.valuesCount,
      );
    });

    reply(port, {
      type: "evaluate-mse-result",
      requestId: msg.requestId,
      totalError,
    });
    return;
  }
}

type BrokerScope = {
  onmessage: ((ev: MessageEvent<ConnectMsg>) => void | Promise<void>) | null;
};
const ctx = self as unknown as BrokerScope;

ctx.onmessage = (ev: MessageEvent<ConnectMsg>) => {
  const msg = ev.data;
  if (msg?.type !== "connect" || !msg.port) return;

  const port = msg.port;
  port.onmessage = async (pev: MessageEvent<ClientMsg>) => {
    const req = pev.data;
    try {
      await handleClientMessage(port, req);
    } catch (e) {
      reply(port, {
        type: "error",
        requestId: req.requestId,
        message: e instanceof Error ? e.message : String(e),
      });
    }
  };
  // Required in some runtimes.
  port.start?.();
};
