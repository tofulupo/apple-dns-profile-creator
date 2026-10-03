import type { PlistDict } from "./plist.ts";
import type { DnsConfig } from "./types.ts";

export function buildOnDemandRules(config: DnsConfig): PlistDict[] {
  // Apple stops at the first matching rule, so the catch-all must stay last.
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

  return rules;
}
