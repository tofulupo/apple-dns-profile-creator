/**
 * Tests for address validation and list parsing.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { join } from "@std/path";

import { parseProfileXml } from "../../src/lib/import.ts";
import {
  configProblems,
  hasProblems,
  isIPv4,
  isIPv6,
  MAX_SSID_BYTES,
  parseLines,
  parseList,
  serverError,
} from "../../src/lib/validate.ts";
import { config, fullSurfaceConfigs } from "../helpers/configs.ts";
import { extractedFixtures, plainXmlFixtures } from "../helpers/fixtures.ts";

describe("isIPv4", () => {
  for (
    const value of [
      "0.0.0.0",
      "1.1.1.1",
      "10.0.0.1",
      "100.64.0.9",
      "192.0.2.1",
      "255.255.255.255",
    ]
  ) {
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
      // Leading zeros: octal to some parsers, decimal to others.
      "01.1.1.1",
      "010.0.0.1",
      "1.1.1.00",
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
      "fe80::1",
    ]
  ) {
    it(`accepts ${value}`, () => expect(isIPv6(value)).toBe(true));
  }

  for (
    const value of [
      "",
      "192.0.2.1",
      "2001:db8:::1",
      "gggg::1",
      "nonsense",
      // A zone index names an interface on one machine only.
      "fe80::1%eth0",
    ]
  ) {
    it(`rejects ${JSON.stringify(value)}`, () =>
      expect(isIPv6(value)).toBe(false));
  }
});

describe("serverError", () => {
  it("requires a value for either protocol", () => {
    expect(serverError("HTTPS", "")).toBe("A server address is required.");
    expect(serverError("TLS", "")).toBe("A server address is required.");
  });

  for (
    const value of [
      "https://dns.quad9.net/dns-query",
      "https://dns.example.com/dns-query/abc123",
      "https://[2606:4700::1111]/dns-query",
      "https://1.1.1.1/dns-query",
    ]
  ) {
    it(`accepts DoH ${value}`, () =>
      expect(serverError("HTTPS", value)).toBeNull());
  }

  for (
    const value of [
      "http://dns.example.com/dns-query",
      "dns.example.com/dns-query",
      "https://",
      "https:// dns.example.com",
      "https://dns.example.com/dns query",
    ]
  ) {
    it(`rejects DoH ${JSON.stringify(value)}`, () =>
      expect(serverError("HTTPS", value)).toBe(
        "A DoH server must be an https:// URL.",
      ));
  }

  for (const value of ["dns.quad9.net", "1.1.1.1", "dot.example.com."]) {
    it(`accepts DoT ${value}`, () =>
      expect(serverError("TLS", value)).toBeNull());
  }

  it("rejects a DoT port", () => {
    expect(serverError("TLS", "dns.quad9.net:853")).toContain("Custom ports");
  });

  for (
    const value of [
      "localhost",
      "https//dns.quad9.net",
      "dns quad9.net",
      "dns.",
    ]
  ) {
    it(`rejects DoT ${JSON.stringify(value)}`, () =>
      expect(serverError("TLS", value)).toBe(
        "A DoT server must be a host name such as dot.example.com.",
      ));
  }

  it("accepts the server of every golden profile", async () => {
    const dir = join(import.meta.dirname ?? ".", "..", "golden");
    for await (const entry of Deno.readDir(dir)) {
      const xml = await Deno.readTextFile(join(dir, entry.name));
      for (const config of parseProfileXml(xml)) {
        expect(serverError(config.protocol, config.serverUrl), entry.name)
          .toBeNull();
      }
    }
  });
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

describe("parseLines", () => {
  it("returns nothing for blank input", () => {
    expect(parseLines("")).toEqual([]);
    expect(parseLines("  \n\t\n")).toEqual([]);
  });

  it("splits on newlines only, so commas stay inside a name", () => {
    expect(parseLines("Home, Sweet Home\nOffice")).toEqual([
      "Home, Sweet Home",
      "Office",
    ]);
  });

  it("keeps leading and trailing spaces, which are part of an SSID", () => {
    expect(parseLines(" Cafe \nOffice")).toEqual([" Cafe ", "Office"]);
  });

  it("accepts Windows line endings and drops blank lines", () => {
    expect(parseLines("a\r\n\r\nb\n")).toEqual(["a", "b"]);
  });
});

describe("configProblems", () => {
  it("finds nothing wrong with a valid configuration", () => {
    for (const valid of [config(), ...fullSurfaceConfigs()]) {
      expect(configProblems(valid)).toEqual({});
      expect(hasProblems(configProblems(valid))).toBe(false);
    }
  });

  it("requires a name that is not just spaces", () => {
    expect(configProblems(config({ name: "" })).name).toBe(
      "Give the provider a name.",
    );
    expect(configProblems(config({ name: "   " })).name).toBeDefined();
  });

  it("checks the server against the protocol", () => {
    expect(
      configProblems(config({ protocol: "HTTPS", serverUrl: "dot.example" }))
        .serverUrl,
    ).toBe("A DoH server must be an https:// URL.");
    expect(configProblems(config({ serverUrl: "" })).serverUrl).toBe(
      "A server address is required.",
    );
  });

  it("names every resolver address that is not an IP", () => {
    expect(
      configProblems(
        config({ serverAddresses: ["192.0.2.1", "x", "010.0.0.1"] }),
      )
        .serverAddresses,
    ).toBe("Not valid IP addresses: x, 010.0.0.1");
  });

  it("measures SSIDs in UTF-8 bytes, not characters", () => {
    const fits = ["a".repeat(MAX_SSID_BYTES), "é".repeat(MAX_SSID_BYTES / 2)];
    expect(configProblems(config({ excludedWifi: fits }))).toEqual({});

    const tooLong = ["a".repeat(MAX_SSID_BYTES + 1), "😀".repeat(9)];
    const problem = configProblems(config({ excludedWifi: tooLong }))
      .excludedWifi;
    expect(problem).toContain(`“${"a".repeat(MAX_SSID_BYTES + 1)}”`);
    expect(problem).toContain(`“${"😀".repeat(9)}”`);
  });

  it("reports every field at once", () => {
    const broken = config({
      name: "",
      serverUrl: "",
      serverAddresses: ["nope"],
      excludedWifi: ["x".repeat(40)],
    });
    expect(Object.keys(configProblems(broken)).sort()).toEqual([
      "excludedWifi",
      "name",
      "serverAddresses",
      "serverUrl",
    ]);
  });

  it("passes every upstream fixture and golden profile as imported", async () => {
    const golden = join(import.meta.dirname ?? ".", "..", "golden");
    const sources = [...plainXmlFixtures(), ...extractedFixtures()]
      .map((f) => ({ name: f.name, text: f.text }));
    for await (const entry of Deno.readDir(golden)) {
      sources.push({
        name: entry.name,
        text: await Deno.readTextFile(join(golden, entry.name)),
      });
    }
    for (const source of sources) {
      for (const imported of parseProfileXml(source.text)) {
        expect({ source: source.name, problems: configProblems(imported) })
          .toEqual({ source: source.name, problems: {} });
      }
    }
  });
});
