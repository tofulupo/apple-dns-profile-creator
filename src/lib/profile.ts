/**
 * Builds an Apple configuration profile from a set of DNS configurations.
 */

import { collectServerAddresses } from "./addresses.ts";
import { buildPlist, type PlistDict } from "./plist.ts";
import type { DnsConfig, ProfileOptions, UuidFactory } from "./types.ts";

const PROFILE_DESCRIPTION =
  "Adds different encrypted DNS configurations to Big Sur (or newer) and iOS 14 (or newer) based systems";
const PROFILE_DISPLAY_NAME = "Encrypted DNS (DoH, DoT)";

export const DEFAULT_IDENTIFIER_PREFIX = "local.encrypted-dns.";
const PAYLOAD_TYPE = "com.apple.dnsSettings.managed";
const PAYLOAD_IDENTIFIER_PREFIX = `${PAYLOAD_TYPE}.`;

/**
 * Builds the `com.apple.dnsSettings.managed` payload for one configuration.
 *
 * `uuid` is called exactly twice, in the same order as the original: first for
 * `PayloadIdentifier`, then for `PayloadUUID`.
 */
function buildPayload(config: DnsConfig, uuid: UuidFactory): PlistDict {
  const dnsSettings: PlistDict = {
    DNSProtocol: config.protocol,
    // Always present, even when empty. Upstream profiles omit the key in that
    // case; harmless either way, because an empty <array/> parses back to an
    // empty list.
    ServerAddresses: collectServerAddresses(config.serverAddresses),
  };

  if (config.protocol === "HTTPS") {
    dnsSettings.ServerURL = config.serverUrl;
  } else {
    dnsSettings.ServerName = config.serverUrl;
  }

  // Rule order is load-bearing: Apple evaluates on-demand rules top to bottom
  // and stops at the first match, so the catch-all Disconnect must stay last.
  const rules: PlistDict[] = [];

  if (config.excludedWifi.length > 0) {
    rules.push({
      Action: "Disconnect",
      SSIDMatch: [...config.excludedWifi],
    });
  }

  if (config.excludedDomains.length > 0) {
    rules.push({
      Action: "EvaluateConnection",
      ActionParameters: [
        {
          DomainAction: "NeverConnect",
          Domains: [...config.excludedDomains],
        },
      ],
    });
  }

  if (config.useWifi) {
    rules.push({ Action: "Connect", InterfaceTypeMatch: "WiFi" });
  }
  if (config.useCellular) {
    rules.push({ Action: "Connect", InterfaceTypeMatch: "Cellular" });
  }
  if (config.useEthernet) {
    rules.push({ Action: "Connect", InterfaceTypeMatch: "Ethernet" });
  }

  rules.push({ Action: "Disconnect" });

  return {
    DNSSettings: dnsSettings,
    OnDemandRules: rules,
    PayloadDescription:
      `Configures device to use ${config.name} Encrypted DNS over ${config.protocol}`,
    PayloadDisplayName: config.name,
    PayloadIdentifier: PAYLOAD_IDENTIFIER_PREFIX + uuid(),
    PayloadType: PAYLOAD_TYPE,
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
