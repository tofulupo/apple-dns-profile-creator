import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { appConfig, PRESET_FEATURE_LABELS } from "../src/config.ts";
import {
  orderServerAddresses,
  splitServerAddresses,
} from "../src/lib/addresses.ts";
import { isIPv4, isIPv6, serverError } from "../src/lib/validate.ts";
import { countryName, flagFile } from "../scripts/build.ts";

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
