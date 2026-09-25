/**
 * Round-trip properties: export then import must return what went in.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { appConfig } from "../../src/config.ts";
import { collectServerAddresses } from "../../src/lib/addresses.ts";
import { parseProfile, parseProfileXml } from "../../src/lib/import.ts";
import { buildProfile, buildProfileXml } from "../../src/lib/profile.ts";
import type { DnsConfig } from "../../src/lib/types.ts";
import { config, fullSurfaceConfigs } from "../helpers/configs.ts";
import { stubUuid } from "../helpers/uuid.ts";

/** Export a config and import it straight back. */
function roundTrip(input: DnsConfig): DnsConfig {
  const profile = buildProfile([input], { systemScope: false }, stubUuid());
  const [output] = parseProfile(profile);
  expect(output).toBeDefined();
  return output as DnsConfig;
}

describe("fields that survive today", () => {
  it("preserves the protocol and server for DoT", () => {
    const input = config({ protocol: "TLS", serverUrl: "dot.example.com" });
    const output = roundTrip(input);
    expect(output.protocol).toBe("TLS");
    expect(output.serverUrl).toBe("dot.example.com");
  });

  it("preserves the protocol and server for DoH", () => {
    const input = config({ protocol: "HTTPS", serverUrl: "https://e.test/q" });
    const output = roundTrip(input);
    expect(output.protocol).toBe("HTTPS");
    expect(output.serverUrl).toBe("https://e.test/q");
  });

  it("preserves resolver addresses and their order", () => {
    expect(roundTrip(config()).serverAddresses).toEqual([
      "2001:db8::1",
      "2001:db8::2",
      "192.0.2.1",
      "192.0.2.2",
    ]);
  });

  it("preserves excluded SSIDs", () => {
    const input = config({ excludedWifi: ["Home", "Silence of the LANs"] });
    expect(roundTrip(input).excludedWifi).toEqual([
      "Home",
      "Silence of the LANs",
    ]);
  });

  it("preserves excluded domains", () => {
    const input = config({ excludedDomains: ["example.com", "internal.lan"] });
    expect(roundTrip(input).excludedDomains).toEqual([
      "example.com",
      "internal.lan",
    ]);
  });

  it("preserves ProhibitDisablement", () => {
    expect(roundTrip(config({ prohibitDisablement: true })).prohibitDisablement)
      .toBe(true);
    expect(
      roundTrip(config({ prohibitDisablement: false })).prohibitDisablement,
    ).toBe(false);
  });

  it("preserves AllowFailover, and leaves it absent when unset", () => {
    expect(roundTrip(config({ allowFailover: true })).allowFailover).toBe(true);
    expect(roundTrip(config({ allowFailover: false })).allowFailover)
      .toBeUndefined();
    expect(roundTrip(config()).allowFailover).toBeUndefined();
  });

  it("preserves SupplementalMatchDomains, and leaves it absent when empty", () => {
    const domains = ["*.example.com", "internal.lan"];
    expect(
      roundTrip(config({ supplementalMatchDomains: domains }))
        .supplementalMatchDomains,
    ).toEqual(domains);
    expect(
      roundTrip(config({ supplementalMatchDomains: [] }))
        .supplementalMatchDomains,
    ).toBeUndefined();
    expect(roundTrip(config()).supplementalMatchDomains).toBeUndefined();
  });

  it("preserves enabled interfaces", () => {
    const output = roundTrip(
      config({ useWifi: true, useCellular: true, useEthernet: true }),
    );
    expect(output.useWifi).toBe(true);
    expect(output.useCellular).toBe(true);
    expect(output.useEthernet).toBe(true);
  });
});

describe("previously broken round-trips", () => {
  it("preserves the provider name", () => {
    expect(roundTrip(config({ name: "Quad9" })).name).toBe("Quad9");
  });

  it("is stable across repeated cycles", () => {
    const once = roundTrip(config({ name: "Quad9" }));
    const twice = roundTrip(once);
    expect(twice).toEqual(once);
  });

  it("preserves a disabled interface as disabled", () => {
    const output = roundTrip(
      config({ useWifi: true, useCellular: false, useEthernet: false }),
    );
    expect(output.useCellular).toBe(false);
    expect(output.useEthernet).toBe(false);
  });

  it("preserves all interfaces disabled", () => {
    const output = roundTrip(
      config({ useWifi: false, useCellular: false, useEthernet: false }),
    );
    expect(output.useWifi).toBe(false);
    expect(output.useCellular).toBe(false);
    expect(output.useEthernet).toBe(false);
  });

  it("survives a full round-trip unchanged", () => {
    const input = config({
      name: "Example DNS",
      protocol: "HTTPS",
      serverUrl: "https://dns.example/query",
      excludedWifi: ["Home"],
      excludedDomains: ["internal.lan"],
      useWifi: true,
      useCellular: false,
      useEthernet: true,
      prohibitDisablement: true,
      allowFailover: true,
      supplementalMatchDomains: ["*.example.com"],
    });
    expect(roundTrip(input)).toEqual(input);
  });

  it("is idempotent for every upstream-style default", () => {
    for (const protocol of ["HTTPS", "TLS"] as const) {
      const input = config({ protocol, name: "Provider" });
      expect(roundTrip(roundTrip(input))).toEqual(roundTrip(input));
    }
  });
});

/**
 * Export several configs as the XML a user downloads, and upload it again.
 * Going through the text rather than the dictionary covers the same path as
 * a real download and re-import on either page.
 */
function roundTripXml(input: readonly DnsConfig[]): DnsConfig[] {
  const xml = buildProfileXml([...input], { systemScope: true }, stubUuid());
  return parseProfileXml(xml);
}

describe("multi-configuration profiles", () => {
  it("round-trips every quick preset in one profile, in order", () => {
    // What the tool page stores after a preset click: the preset's name,
    // protocol and server, no resolver addresses, form defaults otherwise.
    const input = appConfig.presets.map((preset) =>
      config({
        name: preset.name,
        protocol: preset.protocol,
        serverUrl: preset.serverUrl,
        serverAddresses: [],
      })
    );
    expect(input.length).toBeGreaterThan(1);
    expect(roundTripXml(input)).toEqual(input);
  });

  it("round-trips a mix of DoH and DoT with every field set", () => {
    const input = fullSurfaceConfigs();
    expect(new Set(input.map((c) => c.protocol))).toEqual(
      new Set(["HTTPS", "TLS"]),
    );
    expect(roundTripXml(input)).toEqual(input);
  });

  it("keeps same-named configurations apart", () => {
    const input = [
      config({ name: "Twin", serverUrl: "one.example.com" }),
      config({ name: "Twin", serverUrl: "two.example.com" }),
    ];
    expect(roundTripXml(input)).toEqual(input);
  });
});

describe("resolver address capacity", () => {
  it("round-trips more than two addresses per family", () => {
    const serverAddresses = [
      "2001:db8::1",
      "2001:db8::2",
      "2001:db8::3",
      "192.0.2.1",
      "192.0.2.2",
      "192.0.2.3",
    ];
    expect(roundTrip(config({ serverAddresses })).serverAddresses).toEqual(
      serverAddresses,
    );
  });

  it("round-trips an empty address list", () => {
    expect(roundTrip(config({ serverAddresses: [] })).serverAddresses).toEqual(
      [],
    );
  });

  it("ignores entries that are neither IPv4 nor IPv6", () => {
    expect(collectServerAddresses(["nonsense", "192.0.2.1", ""])).toEqual([
      "192.0.2.1",
    ]);
  });
});
