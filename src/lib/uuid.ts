/**
 * UUID generation that works over plain HTTP.
 */

const UUID_BYTES = 16;

export function uuidFromBytes(source: Uint8Array): string {
  if (source.length !== UUID_BYTES) {
    throw new RangeError(
      `A UUID needs exactly ${UUID_BYTES} bytes, received ${source.length}`,
    );
  }

  const bytes = new Uint8Array(source);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;

  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join("-");
}

export function randomUuid(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return uuidFromBytes(crypto.getRandomValues(new Uint8Array(UUID_BYTES)));
}
