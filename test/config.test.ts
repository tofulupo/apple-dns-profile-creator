import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  appConfig,
  keepsTypedName,
  PRESET_FEATURE_LABELS,
  presetFeatures,
  presetOf,
  withPreset,
} from "../src/config.ts";
import { parseProfileXml } from "../src/lib/import.ts";
import {
  orderServerAddresses,
  splitServerAddresses,
} from "../src/lib/addresses.ts";
import { isIPv4, isIPv6, serverError } from "../src/lib/validate.ts";
import { countryName, flagFile } from "../scripts/build.ts";

const MULLVAD_WITH_RULES = Deno.readTextFileSync(
  new URL("./fixtures/own/mullvad-with-rules.mobileconfig", import.meta.url),
);

describe("picking a preset for a loaded profile", () => {
  const quad9 = appConfig.presets.find((preset) => preset.name === "Quad9")!;

  it("changes only name, server and addresses, and keeps every rule", () => {
    const [mullvad] = parseProfileXml(MULLVAD_WITH_RULES);
    if (mullvad === undefined) throw new Error("No configuration");
    expect(mullvad.excludedWifi).toEqual(["Home Fritzbox", "Office Guest"]);

    const { name, protocol, serverUrl, serverAddresses, ...rules } = withPreset(
      mullvad,
      quad9,
      false,
    );
    expect({ name, protocol, serverUrl, serverAddresses }).toEqual({
      name: "Quad9",
      protocol: quad9.protocol,
      serverUrl: quad9.serverUrl,
      serverAddresses: quad9.serverAddresses,
    });
    const {
      name: _name,
      protocol: _protocol,
      serverUrl: _serverUrl,
      serverAddresses: _addresses,
      ...before
    } = mullvad;
    expect(rules).toEqual(before);
  });

  it("keeps a name the user typed, not one from the file or a preset", () => {
    const fromFile = "Mullvad Encrypted DNS with all blocking enabled (HTTPS)";
    expect(keepsTypedName(fromFile, fromFile)).toBe(false);
    expect(keepsTypedName(` ${fromFile} `, fromFile)).toBe(false);
    expect(keepsTypedName("Family phones", fromFile)).toBe(true);
    expect(keepsTypedName("Family phones", undefined)).toBe(true);
    expect(keepsTypedName("HaGeZi", undefined)).toBe(false);
    expect(keepsTypedName("  ", undefined)).toBe(false);
  });
});

describe("presets", () => {
  it("have unique names", () => {
    const names = appConfig.presets.map((preset) => preset.name);
    expect(new Set(names).size).toBe(names.length);
  });

  for (const preset of appConfig.presets) {
    it(`${preset.name} has a name`, () => {
      expect(preset.name.trim()).not.toBe("");
    });

    it(`${preset.name} passes the form's server check`, () => {
      expect(serverError(preset.protocol, preset.serverUrl)).toBeNull();
    });

    it(`${preset.name} has only valid, distinct resolver addresses`, () => {
      const addresses = preset.serverAddresses ?? [];
      expect(addresses.filter((a) => !isIPv4(a) && !isIPv6(a))).toEqual([]);
      expect(new Set(addresses).size).toBe(addresses.length);
    });

    it(`${preset.name} fits the address fields, IPv4 first`, () => {
      const addresses = preset.serverAddresses ?? [];
      expect(splitServerAddresses(addresses).dropped).toEqual([]);
      expect(orderServerAddresses(addresses)).toEqual(addresses);
    });

    it(`${preset.name} names a real country, if any`, () => {
      if (preset.country !== undefined) {
        expect(countryName(preset.country)).toBeDefined();
      }
    });

    // Copied from flag-icons' flags/4x3/ as countries are added.
    it(`${preset.name} has its country's flag, if any`, () => {
      if (preset.country !== undefined) {
        expect(Deno.statSync(flagFile(preset.country)).isFile).toBe(true);
      }
    });

    it(`${preset.name} lists each known feature once`, () => {
      const features = preset.features ?? [];
      expect(features.filter((f) => !Object.hasOwn(PRESET_FEATURE_LABELS, f)))
        .toEqual([]);
      expect(new Set(features).size).toBe(features.length);
    });
  }
});

describe("presetFeatures", () => {
  it("lists features in menu order, whatever order the preset gives", () => {
    expect(presetFeatures({
      name: "Example",
      protocol: "HTTPS",
      serverUrl: "https://doh.example.net/dns-query",
      features: ["blocking", "ads", "dnssec", "no-logs"],
    })).toEqual(["No logs", "DNSSEC", "Ad blocking", "Malware blocking"]);
  });

  it("is empty without features", () => {
    expect(presetFeatures({
      name: "Example",
      protocol: "TLS",
      serverUrl: "dot.example.net",
    })).toEqual([]);
  });
});

describe("presetOf", () => {
  const quad9 = appConfig.presets.find((preset) => preset.name === "Quad9");

  it("finds the preset by protocol and server", () => {
    expect(presetOf({
      protocol: "HTTPS",
      serverUrl: " https://dns.quad9.net/dns-query ",
    })).toBe(quad9);
  });

  it("finds none for another protocol or an edited server", () => {
    expect(presetOf({
      protocol: "TLS",
      serverUrl: "https://dns.quad9.net/dns-query",
    })).toBeUndefined();
    expect(presetOf({
      protocol: "HTTPS",
      serverUrl: "https://dns.quad9.net/dns-query/",
    })).toBeUndefined();
  });
});

describe("countryName", () => {
  it("names a region code in English", () => {
    expect(countryName("SE")).toBe("Sweden");
  });

  it("refuses what is not a region code", () => {
    expect(countryName("se")).toBeUndefined();
    expect(countryName("XX")).toBeUndefined();
    expect(countryName("Sweden")).toBeUndefined();
  });
});
