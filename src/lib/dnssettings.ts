import { collectServerAddresses } from "./addresses.ts";
import type { PlistDict } from "./plist.ts";
import type { DnsConfig } from "./types.ts";

export function buildDnsSettings(config: DnsConfig): PlistDict {
  const settings: PlistDict = {
    DNSProtocol: config.protocol,

    ServerAddresses: collectServerAddresses(config.serverAddresses),
  };

  if (config.protocol === "HTTPS") {
    settings.ServerURL = config.serverUrl;
  } else {
    settings.ServerName = config.serverUrl;
  }

  // Omitted when unset, so older profiles serialise byte for byte.
  if (config.allowFailover === true) {
    settings.AllowFailover = true;
  }

  const matchDomains = config.supplementalMatchDomains ?? [];
  if (matchDomains.length > 0) {
    settings.SupplementalMatchDomains = [...matchDomains];
  }

  return settings;
}
