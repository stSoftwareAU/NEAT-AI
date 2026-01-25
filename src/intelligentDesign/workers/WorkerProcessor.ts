/**
 * Worker processor for Intelligent Design scoring operations.
 *
 * This processor handles scoring requests using `Creature.scoreDir()`.
 *
 * @module
 */

import { addTag } from "@stsoftware/tags/mod";
import { assert } from "@std/assert";
import { Creature } from "../../Creature.ts";
import {
  initWasmActivationSync,
  isWasmActivationAvailable,
} from "../../wasm/mod.ts";
import type { RequestData } from "./WorkerHandler.ts";
import type { ResponseData } from "./ResponseData.ts";

/**
 * Processes scoring requests in a worker thread.
 */
export class WorkerProcessor {
  private wasmInitAttempted = false;

  private async initialiseWasmActivationFromPayload(
    payload: RequestData["initialize"] | undefined,
  ): Promise<void> {
    if (!payload) return;
    if (this.wasmInitAttempted) return;
    this.wasmInitAttempted = true;

    if (isWasmActivationAvailable()) return;

    const jsModuleUrl = `data:application/javascript;charset=utf-8,${
      encodeURIComponent(payload.wasmActivation.jsSource)
    }`;
    const jsBindings = await import(jsModuleUrl);

    const ok = initWasmActivationSync(
      jsBindings,
      payload.wasmActivation.wasmBinary,
    );
    assert(ok, "Intelligent Design worker WASM activation init failed");
  }

  /**
   * Processes a scoring request.
   *
   * @param data - The request data containing the creature and scoring parameters
   * @returns The scoring result including the score, error, and updated creature JSON
   */
  async process(data: RequestData): Promise<ResponseData> {
    const start = Date.now();
    if (data.initialize) {
      await this.initialiseWasmActivationFromPayload(data.initialize);
      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        initialize: {
          status: "OK",
        },
      };
    } else if (data.score) {
      const { uuid, creature, dataDir, options } = data.score;
      const json = JSON.parse(creature);
      const adjustedCreature = Creature.fromJSON(json);
      adjustedCreature.fix();
      const result = adjustedCreature.scoreDir(dataDir, options);
      const exported = adjustedCreature.exportJSON();
      addTag(exported, "score", `${result.score}`);
      addTag(exported, "error", `${result.error}`);

      return {
        taskID: data.taskID,
        duration: Date.now() - start,
        score: {
          uuid: uuid,
          score: result.score,
          creature: JSON.stringify(exported, null, 1),
          error: result.error,
        },
      };
    } else {
      throw new Error("unknown message");
    }
  }
}
