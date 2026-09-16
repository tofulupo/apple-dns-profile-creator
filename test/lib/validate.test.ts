/**
 * Tests for address validation and list parsing.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { isIPv4, isIPv6, parseList } from "../../src/lib/validate.ts";

describe("isIPv4", () => {
  for (const value of ["0.0.0.0", "1.1.1.1", "192.0.2.1", "255.255.255.255"]) {
    it(`accepts ${value}`, () => expect(isIPv4(value)).toBe(true));
  }

  for (
    const value of [
      "",
      "256.1.1.1",
      "1.1.1",
      "1.1.1.1.1",
      "1.1.1.-1",
      "not-an-address",
      "1.1.1.1 ",
      "2001:db8::1",
    ]
  ) {
    it(`rejects ${JSON.stringify(value)}`, () =>
      expect(isIPv4(value)).toBe(false));
  }
});

describe("isIPv6", () => {
  for (
    const value of [
      "2001:db8::1",
      "2606:4700:4700::1111",
      "2620:fe::fe:11",
      "::1",
      "::",
      "2001:0db8:0000:0000:0000:0000:0000:0001",
      "::ffff:192.0.2.1",
      "fe80::1%eth0",
    ]
  ) {
    it(`accepts ${value}`, () => expect(isIPv6(value)).toBe(true));
  }

  for (
    const value of ["", "192.0.2.1", "2001:db8:::1", "gggg::1", "nonsense"]
  ) {
    it(`rejects ${JSON.stringify(value)}`, () =>
      expect(isIPv6(value)).toBe(false));
  }
});

describe("parseList", () => {
  it("returns nothing for blank input", () => {
    expect(parseList("")).toEqual([]);
    expect(parseList("   \n  ")).toEqual([]);
  });

  it("splits on commas and trims", () => {
    expect(parseList("a, b ,c")).toEqual(["a", "b", "c"]);
  });

  it("splits on newlines", () => {
    expect(parseList("a\nb\r\nc")).toEqual(["a", "b", "c"]);
  });

  it("accepts a mixture of both separators", () => {
    expect(parseList("a, b\nc,\nd")).toEqual(["a", "b", "c", "d"]);
  });

  it("drops blank entries instead of emitting them", () => {
    // The original kept them, so a trailing comma produced an empty SSID in the
    // generated profile.
    expect(parseList("a,,b,")).toEqual(["a", "b"]);
    expect(parseList(",")).toEqual([]);
  });

  it("keeps spaces inside an entry", () => {
    expect(parseList("Silence of the LANs, Home")).toEqual([
      "Silence of the LANs",
      "Home",
    ]);
  });
});
