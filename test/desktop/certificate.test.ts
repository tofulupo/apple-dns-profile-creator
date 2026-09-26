/**
 * Tests for reading a certificate's Subject Key Identifier.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { pemToDer, subjectKeyId } from "../../src/desktop/certificate.ts";
import { WITH_SKI, WITHOUT_SKI } from "../helpers/certificates.ts";

describe("subjectKeyId", () => {
  it("reads the identifier openssl reports", () => {
    expect(subjectKeyId(pemToDer(WITH_SKI.pem))).toBe(WITH_SKI.subjectKeyId);
  });

  it("is undefined for a certificate without the extension", () => {
    expect(subjectKeyId(pemToDer(WITHOUT_SKI.pem))).toBeUndefined();
  });

  it("is undefined for truncated or unrelated data instead of throwing", () => {
    const der = pemToDer(WITH_SKI.pem);
    for (
      const bytes of [
        new Uint8Array(),
        der.subarray(0, 40),
        der.subarray(0, der.length - 1),
        new TextEncoder().encode("not a certificate"),
        Uint8Array.of(0x30, 0x80, 0x00, 0x00),
      ]
    ) {
      expect(subjectKeyId(bytes)).toBeUndefined();
    }
  });
});
