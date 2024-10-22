import { concat } from "@std/bytes";
import { crypto as stdCrypto } from "@std/crypto";

export function generate(
  namespace: string,
  data: Uint8Array,
): string {
  const namespaceBytes = uuidToBytes(namespace);
  const toHash = concat([namespaceBytes, data]);

  const buffer = stdCrypto.subtle.digestSync("SHA-1", toHash);
  const bytes = new Uint8Array(buffer);

  bytes[6] = (bytes[6]! & 0x0f) | 0x50;
  bytes[8] = (bytes[8]! & 0x3f) | 0x80;

  return bytesToUuid(bytes);
}

function bytesToUuid(bytes: number[] | Uint8Array): string {
  const bits = [...bytes].map((bit) => {
    const s = bit.toString(16);
    return bit < 0x10 ? "0" + s : s;
  });
  return [
    ...bits.slice(0, 4),
    "-",
    ...bits.slice(4, 6),
    "-",
    ...bits.slice(6, 8),
    "-",
    ...bits.slice(8, 10),
    "-",
    ...bits.slice(10, 16),
  ].join("");
}

/**
 * Converts a string to a byte array by converting the hex value to a number.
 * @param uuid Value that gets converted.
 */
function uuidToBytes(uuid: string): Uint8Array {
  const bytes = uuid
    .replaceAll("-", "")
    .match(/.{1,2}/g)!
    .map((byte) => parseInt(byte, 16));
  return new Uint8Array(bytes);
}
