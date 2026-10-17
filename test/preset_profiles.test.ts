import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join } from "@std/path";

import { appConfig } from "../src/config.ts";
import {
  extractPlistXml,
  importProfileXml,
  parseProfileXml,
} from "../src/lib/import.ts";
import {
  presetConfig,
  presetFile,
  presetProfiles,
  presetUuids,
  SIGNED_PROFILES,
} from "../scripts/preset_profiles.ts";

const UUID =
  /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
/** The tag a DER signed message starts with. A plain profile starts with `<`. */
const SEQUENCE = 0x30;
const RESIGN =
  'run `deno task profiles "<certificate>"` on a Mac and commit public/profiles/';

function signedFiles(): string[] {
  try {
    return [...Deno.readDirSync(SIGNED_PROFILES)]
      .map((entry) => entry.name)
      .filter((name) => name.endsWith(".mobileconfig"))
      .sort();
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return [];
    throw error;
  }
}

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

  it("read back as the preset with the form's defaults, as declarations", async () => {
    for (const { preset, xml } of await presetProfiles()) {
      const [config, ...rest] = parseProfileXml(xml);
      expect(rest).toEqual([]);
      const { name, protocol, serverUrl, serverAddresses, paradigm, ...rules } =
        config!;
      expect({ name, protocol, serverUrl, serverAddresses, paradigm }).toEqual({
        name: preset.name,
        protocol: preset.protocol,
        serverUrl: preset.serverUrl,
        serverAddresses: preset.serverAddresses ?? [],
        paradigm: "declarations",
      });
      const {
        name: _name,
        protocol: _protocol,
        serverUrl: _serverUrl,
        serverAddresses: _addresses,
        ...defaults
      } = presetConfig(preset);
      expect(rules).toMatchObject(defaults);
      expect(importProfileXml(xml).systemScope).toBe(true);
    }
  });

  it("come out the same every time", async () => {
    const [first, second] = await Promise.all([
      presetProfiles(),
      presetProfiles(),
    ]);
    expect(second).toEqual(first);
  });

  it("never share a UUID, within a profile or between presets", async () => {
    const uuids: string[] = [];
    for (const preset of appConfig.presets) {
      const uuid = await presetUuids(preset);
      for (let index = 0; index < 8; index++) uuids.push(uuid());
      expect(uuid).toThrow("needs more UUIDs");
    }
    for (const uuid of uuids) expect(uuid).toMatch(UUID);
    expect(new Set(uuids).size).toBe(uuids.length);
  });
});

describe("the signed profiles in public/profiles/", () => {
  it("are there for every preset and no other", async () => {
    const expected = (await presetProfiles()).map(({ file }) => file).sort();
    expect({ files: signedFiles(), fix: RESIGN }).toEqual({
      files: expected,
      fix: RESIGN,
    });
  });

  it("are signed", () => {
    for (const file of signedFiles()) {
      const first = Deno.readFileSync(join(SIGNED_PROFILES, file))[0];
      expect({ file, signed: first === SEQUENCE, fix: RESIGN }).toEqual({
        file,
        signed: true,
        fix: RESIGN,
      });
    }
  });

  it("hold what the presets give today", async () => {
    for (const { file, xml } of await presetProfiles()) {
      let bytes: Uint8Array;
      try {
        bytes = Deno.readFileSync(join(SIGNED_PROFILES, file));
      } catch {
        continue;
      }
      const inside = extractPlistXml(new TextDecoder().decode(bytes));
      expect({ file, current: inside === extractPlistXml(xml), fix: RESIGN })
        .toEqual({ file, current: true, fix: RESIGN });
    }
  });
});
