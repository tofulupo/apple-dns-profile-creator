/**
 * Tests for UUID generation.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { randomUuid, uuidFromBytes } from "../../src/lib/uuid.ts";

const UUID_V4 =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

describe("uuidFromBytes", () => {
  it("formats 16 bytes with the canonical grouping", () => {
    const bytes = new Uint8Array([
      0x00,
      0x11,
      0x22,
      0x33,
      0x44,
      0x55,
      0x66,
      0x77,
      0x88,
      0x99,
      0xaa,
      0xbb,
      0xcc,
      0xdd,
      0xee,
      0xff,
    ]);
    expect(uuidFromBytes(bytes)).toBe("00112233-4455-4677-8899-aabbccddeeff");
  });

  it("forces the version nibble to 4", () => {
    const uuid = uuidFromBytes(new Uint8Array(16).fill(0xff));
    expect(uuid[14]).toBe("4");
    expect(uuid).toMatch(UUID_V4);
  });

  it("forces the variant bits to 10", () => {
    expect(uuidFromBytes(new Uint8Array(16).fill(0x00))[19]).toBe("8");
    expect(uuidFromBytes(new Uint8Array(16).fill(0xff))[19]).toBe("b");
  });

  it("pads single-digit bytes", () => {
    expect(uuidFromBytes(new Uint8Array(16))).toBe(
      "00000000-0000-4000-8000-000000000000",
    );
  });

  it("does not modify the caller's array", () => {
    const bytes = new Uint8Array(16).fill(0xff);
    uuidFromBytes(bytes);
    expect([...bytes]).toEqual(Array.from({ length: 16 }, () => 0xff));
  });

  it("rejects the wrong number of bytes", () => {
    expect(() => uuidFromBytes(new Uint8Array(15))).toThrow(RangeError);
    expect(() => uuidFromBytes(new Uint8Array(17))).toThrow(RangeError);
    expect(() => uuidFromBytes(new Uint8Array(0))).toThrow(RangeError);
  });
});

describe("randomUuid", () => {
  it("produces a well-formed version 4 UUID", () => {
    expect(randomUuid()).toMatch(UUID_V4);
  });

  it("does not repeat", () => {
    const seen = new Set(Array.from({ length: 1000 }, () => randomUuid()));
    expect(seen.size).toBe(1000);
  });

  it("works without crypto.randomUUID, as on a plain http:// origin", () => {
    const original = crypto.randomUUID;
    try {
      Reflect.deleteProperty(Crypto.prototype, "randomUUID");
      Object.defineProperty(crypto, "randomUUID", {
        value: undefined,
        configurable: true,
      });

      expect(typeof crypto.randomUUID).not.toBe("function");
      expect(randomUuid()).toMatch(UUID_V4);
    } finally {
      Object.defineProperty(crypto, "randomUUID", {
        value: original,
        configurable: true,
        writable: true,
      });
    }
  });
});
