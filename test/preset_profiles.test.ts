import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { appConfig } from "../src/config.ts";
import { importProfileXml, parseProfileXml } from "../src/lib/import.ts";
import {
  presetConfig,
  presetFile,
  presetProfiles,
} from "../scripts/preset_profiles.ts";

const UUID =
  /[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}/g;

describe("the ready-made preset profiles", () => {
  it("are one file per preset, each under its own name", async () => {
    const profiles = await presetProfiles();
    expect(profiles.map((profile) => profile.preset)).toEqual(
      appConfig.presets,
    );
    const files = profiles.map((profile) => profile.file);
    expect(new Set(files).size).toBe(files.length);
    for (const file of files) {
      expect(file).toMatch(/^[a-z0-9-]+\.mobileconfig$/);
    }
    expect(presetFile(appConfig.presets[0]!)).toBe("quad9.mobileconfig");
  });

  it("read back as the preset with the form's defaults", async () => {
    for (const { preset, xml } of await presetProfiles()) {
      const [config, ...rest] = parseProfileXml(xml);
      expect(rest).toEqual([]);
      const { name, protocol, serverUrl, serverAddresses, ...rules } = config!;
      expect({ name, protocol, serverUrl, serverAddresses }).toEqual({
        name: preset.name,
        protocol: preset.protocol,
        serverUrl: preset.serverUrl,
        serverAddresses: preset.serverAddresses ?? [],
      });
      const {
        name: _name,
        protocol: _protocol,
        serverUrl: _serverUrl,
        serverAddresses: _addresses,
        ...defaults
      } = presetConfig(preset);
      expect(rules).toMatchObject(defaults);
      expect(importProfileXml(xml).systemScope).toBe(
        appConfig.systemScopeByDefault,
      );
    }
  });

  it("come out the same on every build", async () => {
    const [first, second] = await Promise.all([
      presetProfiles(),
      presetProfiles(),
    ]);
    expect(second).toEqual(first);
  });

  it("never share a UUID, within a profile or between presets", async () => {
    const uuids = (await presetProfiles())
      .flatMap(({ xml }) => [...new Set(xml.match(UUID))]);
    expect(uuids.length).toBe(appConfig.presets.length * 4);
    expect(new Set(uuids).size).toBe(uuids.length);
  });
});
