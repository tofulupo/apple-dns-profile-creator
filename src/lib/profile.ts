import { buildDnsSettings } from "./dnssettings.ts";
import { buildOnDemandRules } from "./ondemand.ts";
import { buildPlist, type PlistDict } from "./plist.ts";
import type { DnsConfig, ProfileOptions, UuidFactory } from "./types.ts";

const PROFILE_DESCRIPTION = "DNS Profile Creator (.mobileconfig) iOS/macOS 26";
const DECLARATIONS_PROFILE_DESCRIPTION =
  "DNS Profile Creator (.mobileconfig) iOS/macOS 27";
const PROFILE_DISPLAY_NAME = "Encrypted DNS (DoH, DoT)";

export const DEFAULT_IDENTIFIER_PREFIX = "local.encrypted-dns.";
/** Deprecated in iOS 27, macOS 27 and visionOS 27, though still applied. */
export const DNS_PAYLOAD_TYPE = "com.apple.dnsSettings.managed";
const PAYLOAD_IDENTIFIER_PREFIX = `${DNS_PAYLOAD_TYPE}.`;

/** Applies the DNS settings declaration from iOS 27, macOS 27, visionOS 27. */
export const DECLARATIONS_PAYLOAD_TYPE = "com.apple.declarations";

export const DNS_DECLARATION_TYPE =
  "com.apple.configuration.network.dns-settings";

export const ACTIVATION_DECLARATION_TYPE = "com.apple.activation.simple";

/** `uuid`'s call order is locked by the profiles in test/golden. */
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

function declarationData(declaration: PlistDict): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(declaration, null, 2));
}

function buildDeclarationsPayload(
  configs: readonly DnsConfig[],
  uuid: UuidFactory,
): PlistDict {
  const payload: PlistDict = {
    Declarations: [],
    PayloadDescription: "Configures encrypted DNS through declarations",
    PayloadDisplayName: PROFILE_DISPLAY_NAME,
    PayloadIdentifier: `${DECLARATIONS_PAYLOAD_TYPE}.${uuid()}`,
    PayloadType: DECLARATIONS_PAYLOAD_TYPE,
    PayloadUUID: uuid(),
    PayloadVersion: 1,
  };

  const configurations: PlistDict[] = configs.map((config) => ({
    Type: DNS_DECLARATION_TYPE,
    Identifier: uuid(),
    ServerToken: uuid(),
    Payload: {
      VisibleName: config.name,
      DNSSettings: buildDnsSettings(config),
      OnDemandRules: buildOnDemandRules(config),
      ProhibitDisablement: config.prohibitDisablement,
    },
  }));
  const activation: PlistDict = {
    Type: ACTIVATION_DECLARATION_TYPE,
    Identifier: uuid(),
    ServerToken: uuid(),
    Payload: {
      StandardConfigurations: configurations.map((declaration) =>
        declaration["Identifier"] as string
      ),
    },
  };

  payload.Declarations = [activation, ...configurations].map(declarationData);
  return payload;
}

export function buildProfile(
  configs: readonly DnsConfig[],
  options: ProfileOptions,
  uuid: UuidFactory,
): PlistDict {
  const declarations = options.format === "declarations";
  const profile: PlistDict = {
    // Filled in below, so the profile draws its UUIDs before its payloads do,
    // as test/golden expects.
    PayloadContent: [],
    PayloadDescription: declarations
      ? DECLARATIONS_PROFILE_DESCRIPTION
      : PROFILE_DESCRIPTION,
    PayloadDisplayName: PROFILE_DISPLAY_NAME,
    PayloadIdentifier: (options.identifierPrefix ?? DEFAULT_IDENTIFIER_PREFIX) +
      uuid(),
    PayloadRemovalDisallowed: false,
    PayloadType: "Configuration",
    PayloadUUID: uuid(),
    PayloadVersion: 1,
  };

  profile.PayloadContent = declarations
    ? [buildDeclarationsPayload(configs, uuid)]
    : configs.map((config) => buildPayload(config, uuid));

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
