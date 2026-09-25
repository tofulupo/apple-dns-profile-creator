/**
 * Builds an Apple configuration profile from a set of DNS configurations.
 */

import { buildDnsSettings } from "./dnssettings.ts";
import { buildOnDemandRules } from "./ondemand.ts";
import { buildPlist, type PlistDict } from "./plist.ts";
import type { DnsConfig, ProfileOptions, UuidFactory } from "./types.ts";

const PROFILE_DESCRIPTION =
  ".mobileconfig file provides DNS profile for iOS 26 and macOS 26 or higher. https://github.com/tofulupo/apple-dns-profile-creator";
const PROFILE_DISPLAY_NAME = "Encrypted DNS (DoH, DoT)";

export const DEFAULT_IDENTIFIER_PREFIX = "local.encrypted-dns.";
export const DNS_PAYLOAD_TYPE = "com.apple.dnsSettings.managed";
const PAYLOAD_IDENTIFIER_PREFIX = `${DNS_PAYLOAD_TYPE}.`;

/**
 * Builds the `com.apple.dnsSettings.managed` payload for one configuration.
 *
 * `uuid` is called exactly twice, in the same order as the original: first for
 * `PayloadIdentifier`, then for `PayloadUUID`.
 */
function buildPayload(config: DnsConfig, uuid: UuidFactory): PlistDict {
  return {
    DNSSettings: buildDnsSettings(config),
    OnDemandRules: buildOnDemandRules(config),
    PayloadDescription:
      `Configures device to use ${config.name} Encrypted DNS over ${config.protocol}`,
    PayloadDisplayName: config.name,
    PayloadIdentifier: PAYLOAD_IDENTIFIER_PREFIX + uuid(),
    PayloadType: DNS_PAYLOAD_TYPE,
    PayloadUUID: uuid(),
    PayloadVersion: 1,
    ProhibitDisablement: config.prohibitDisablement,
  };
}

export function buildProfile(
  configs: readonly DnsConfig[],
  options: ProfileOptions,
  uuid: UuidFactory,
): PlistDict {
  const profile: PlistDict = {
    // Placeholder, keeping the key first in the output. Filled in below: the
    // profile must draw its two UUIDs before its payloads draw theirs, and a
    // literal would evaluate the payloads first.
    PayloadContent: [],
    PayloadDescription: PROFILE_DESCRIPTION,
    PayloadDisplayName: PROFILE_DISPLAY_NAME,
    PayloadIdentifier: (options.identifierPrefix ?? DEFAULT_IDENTIFIER_PREFIX) +
      uuid(),
    PayloadRemovalDisallowed: false,
    PayloadType: "Configuration",
    PayloadUUID: uuid(),
    PayloadVersion: 1,
  };

  profile.PayloadContent = configs.map((config) => buildPayload(config, uuid));

  if (options.systemScope) {
    profile.PayloadScope = "System";
  }

  return profile;
}

export function buildProfileXml(
  configs: readonly DnsConfig[],
  options: ProfileOptions,
  uuid: UuidFactory,
): string {
  return buildPlist(buildProfile(configs, options, uuid));
}
