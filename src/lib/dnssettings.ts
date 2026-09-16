/**
 * The `DNSSettings` dictionary.
 *
 * Shared verbatim by the `com.apple.dnsSettings.managed` payload and by the
 * `com.apple.configuration.network.dns-settings` declaration.
 */

import { collectServerAddresses } from "./addresses.ts";
import type { PlistDict } from "./plist.ts";
import type { DnsConfig } from "./types.ts";

export function buildDnsSettings(config: DnsConfig): PlistDict {
  const settings: PlistDict = {
    DNSProtocol: config.protocol,
    // Always present, even when empty. Upstream profiles omit the key in that
    // case; harmless either way, because an empty <array/> parses back to an
    // empty list.
    ServerAddresses: collectServerAddresses(config.serverAddresses),
  };

  if (config.protocol === "HTTPS") {
    settings.ServerURL = config.serverUrl;
  } else {
    settings.ServerName = config.serverUrl;
  }

  // Both keys are omitted when unset, so profiles built before they existed
  // still serialise byte for byte.
  if (config.allowFailover === true) {
    settings.AllowFailover = true;
  }

  const matchDomains = config.supplementalMatchDomains ?? [];
  if (matchDomains.length > 0) {
    settings.SupplementalMatchDomains = [...matchDomains];
  }

  return settings;
}
