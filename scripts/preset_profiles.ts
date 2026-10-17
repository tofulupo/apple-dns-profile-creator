import { emptyDir } from "@std/fs";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

import { appConfig, type DnsPreset } from "../src/config.ts";
import { profileFilename } from "../src/lib/filename.ts";
import { buildProfileXml } from "../src/lib/profile.ts";
import type { DnsConfig, UuidFactory } from "../src/lib/types.ts";
import { uuidFromBytes } from "../src/lib/uuid.ts";

const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");

/**
 * Under public/, signed and committed by `deno task profiles` on a Mac. The
 * build copies them to dist/ like the rest of public/.
 */
export const PROFILES_DIR = "profiles";
export const SIGNED_PROFILES = join(ROOT, "public", PROFILES_DIR);
const UNSIGNED_PROFILES = join(ROOT, "build", PROFILES_DIR);

/** A one-configuration profile in the declaration format draws eight. */
const UUIDS_PER_PROFILE = 8;

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
 * The same UUIDs for a preset every time, so a profile signed again after a
 * preset change replaces the installed one.
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
  return await Promise.all(appConfig.presets.map(async (preset) => ({
    preset,
    file: presetFile(preset),
    xml: buildProfileXml(
      [presetConfig(preset)],
      {
        systemScope: true,
        identifierPrefix: appConfig.identifierPrefix,
        format: "declarations",
      },
      await presetUuids(preset),
    ),
  })));
}

if (import.meta.main) {
  const identity = Deno.args[0]?.trim();
  if (identity === undefined || identity === "") {
    console.error(
      'Usage: deno task profiles "<certificate name or SHA-1>"\n' +
        "Signs with a certificate from the Keychain, on macOS.",
    );
    Deno.exit(1);
  }
  await emptyDir(UNSIGNED_PROFILES);
  for (const { file, xml } of await presetProfiles()) {
    await Deno.writeTextFile(join(UNSIGNED_PROFILES, file), xml);
  }
  const { success } = await new Deno.Command("cargo", {
    args: [
      "run",
      "--quiet",
      "--manifest-path",
      "src-tauri/Cargo.toml",
      "--example",
      "sign_profiles",
      "--",
      UNSIGNED_PROFILES,
      SIGNED_PROFILES,
      identity,
    ],
    cwd: ROOT,
  }).output();
  if (!success) Deno.exit(1);
}
