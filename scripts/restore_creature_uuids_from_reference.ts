#!/usr/bin/env -S deno run --allow-read --allow-write
/**
 * Copy stable neuron `uuid` values from a known-good creature export onto a
 * corrupted export where hidden/constant labels were saved as `neuron-{id}`
 * (Issue #2050) or otherwise drifted, without changing topology.
 *
 * Usage:
 *   deno run -A scripts/restore_creature_uuids_from_reference.ts \
 *     --reference path/to/good-network.json \
 *     --corrupted path/to/corrupted-network.json \
 *     --out path/to/fixed-network.json
 *
 * Preconditions:
 * - Same `input`, `output`, and exported `neurons` length (inputs are omitted
 *   from `neurons` in standard exports).
 * - Same `type` (and usually same `bias` / `squash`) at each neuron index.
 *
 * After patching neuron `uuid` fields, synapse `fromUUID` / `toUUID` strings
 * are rewritten using the old→new map. Internal `id` / `fromId` / `toId`
 * fields are deleted so the file matches public uuid-only export shape.
 */

type LooseNeuron = {
  type?: string;
  uuid?: string;
  id?: number;
  bias?: number;
  squash?: string;
};

type LooseSynapse = Record<string, unknown>;

interface LooseCreature {
  input?: number;
  output?: number;
  neurons?: LooseNeuron[];
  synapses?: LooseSynapse[];
  [key: string]: unknown;
}

function getArg(flag: string): string | undefined {
  const i = Deno.args.indexOf(flag);
  if (i >= 0 && Deno.args[i + 1] && !Deno.args[i + 1].startsWith("--")) {
    return Deno.args[i + 1];
  }
  return undefined;
}

function load(path: string): LooseCreature {
  const text = Deno.readTextFileSync(path);
  return JSON.parse(text) as LooseCreature;
}

function main(): void {
  const referencePath = getArg("--reference") ?? getArg("-r");
  const corruptedPath = getArg("--corrupted") ?? getArg("-c");
  const outPath = getArg("--out") ?? getArg("-o");

  if (!referencePath || !corruptedPath || !outPath) {
    console.error(
      "Usage: deno run -A scripts/restore_creature_uuids_from_reference.ts " +
        "--reference good.json --corrupted bad.json --out fixed.json",
    );
    Deno.exit(1);
  }

  const good = load(referencePath);
  const bad = load(corruptedPath);

  const gIn = good.input;
  const gOut = good.output;
  const bIn = bad.input;
  const bOut = bad.output;
  if (
    gIn === undefined || gOut === undefined || bIn === undefined ||
    bOut === undefined
  ) {
    throw new Error("Both files must define input and output counts.");
  }
  if (gIn !== bIn || gOut !== bOut) {
    throw new Error(
      `input/output mismatch: reference ${gIn}/${gOut} vs corrupted ${bIn}/${bOut}`,
    );
  }

  const gNeurons = good.neurons ?? [];
  const bNeurons = bad.neurons ?? [];
  if (gNeurons.length !== bNeurons.length) {
    throw new Error(
      `Neuron count mismatch: reference ${gNeurons.length} vs corrupted ${bNeurons.length}`,
    );
  }

  const uuidMap = new Map<string, string>();
  let patched = 0;

  for (let i = 0; i < gNeurons.length; i++) {
    const gn = gNeurons[i];
    const bn = bNeurons[i];
    if (gn.type !== bn.type) {
      throw new Error(
        `Neuron[${i}] type mismatch: reference ${gn.type} vs corrupted ${bn.type}`,
      );
    }
    const oldUuid =
      typeof bn.uuid === "string" ? bn.uuid : undefined;
    const newUuid =
      typeof gn.uuid === "string" ? gn.uuid : undefined;

    if (gn.type === "hidden" || gn.type === "constant") {
      if (!newUuid) {
        throw new Error(
          `Reference neuron[${i}] (${gn.type}) has no uuid; cannot restore.`,
        );
      }
      if (oldUuid && oldUuid !== newUuid) {
        uuidMap.set(oldUuid, newUuid);
      }
      bn.uuid = newUuid;
      delete bn.id;
      patched++;
    } else {
      if (newUuid && oldUuid && oldUuid !== newUuid) {
        uuidMap.set(oldUuid, newUuid);
      }
      if (newUuid) bn.uuid = newUuid;
      delete bn.id;
    }
  }

  const synapses = bad.synapses ?? [];
  for (const s of synapses) {
    const fu = s.fromUUID;
    const tu = s.toUUID;
    if (typeof fu === "string" && uuidMap.has(fu)) {
      s.fromUUID = uuidMap.get(fu);
    }
    if (typeof tu === "string" && uuidMap.has(tu)) {
      s.toUUID = uuidMap.get(tu);
    }
    delete s.fromId;
    delete s.toId;
  }

  Deno.writeTextFileSync(outPath, JSON.stringify(bad, null, 2) + "\n");
  console.log(
    `Wrote ${outPath} (${patched} hidden/constant neurons aligned, ${uuidMap.size} uuid rewrites).`,
  );
}

main();
