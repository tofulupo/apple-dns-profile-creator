import { appConfig, type DnsPreset } from "../src/config.ts";
import { profileFilename } from "../src/lib/filename.ts";
import { buildProfileXml } from "../src/lib/profile.ts";
import type { DnsConfig, UuidFactory } from "../src/lib/types.ts";
import { uuidFromBytes } from "../src/lib/uuid.ts";

/** Under dist/. The Ansible deploy signs the files here in place. */
export const PROFILES_DIR = "profiles";

/** A one-configuration profile in the payload format draws four. */
const UUIDS_PER_PROFILE = 4;

export interface PresetProfile {
  readonly preset: DnsPreset;
  readonly file: string;
  readonly xml: string;
}

/** The preset as the Tool page's form gives it when nothing else is changed. */
export function presetConfig(preset: DnsPreset): DnsConfig {
  return {
    name: preset.name,
    protocol: preset.protocol,
    serverUrl: preset.serverUrl,
    serverAddresses: preset.serverAddresses ?? [],
    excludedWifi: [],
    excludedDomains: [],
    useWifi: true,
    useCellular: true,
    useEthernet: true,
    prohibitDisablement: false,
  };
}

/** Named as the Profile page would name its download. */
export function presetFile(preset: DnsPreset): string {
  return profileFilename([presetConfig(preset)], {
    signed: false,
    neutral: false,
  });
}

/**
 * The same UUIDs for a preset on every build, so a new download replaces the
 * profile installed from an older one.
 */
export async function presetUuids(preset: DnsPreset): Promise<UuidFactory> {
  const uuids: string[] = [];
  for (let index = 0; index < UUIDS_PER_PROFILE; index++) {
    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${preset.name}\n${index}`),
    );
    uuids.push(uuidFromBytes(new Uint8Array(digest).subarray(0, 16)));
  }
  return () => {
    const uuid = uuids.shift();
    if (uuid === undefined) {
      throw new Error(`${preset.name}'s profile needs more UUIDs`);
    }
    return uuid;
  };
}

export async function presetProfiles(): Promise<PresetProfile[]> {
  return await Promise.all(appConfig.presets.map(async (preset) => {
    return {
      preset,
      file: presetFile(preset),
      xml: buildProfileXml(
        [presetConfig(preset)],
        {
          systemScope: appConfig.systemScopeByDefault,
          identifierPrefix: appConfig.identifierPrefix,
        },
        await presetUuids(preset),
      ),
    };
  }));
}
