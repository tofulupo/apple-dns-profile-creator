import type { DnsConfig } from "../../src/lib/types.ts";

const BASE: DnsConfig = {
  name: "Example DNS",
  protocol: "TLS",
  serverUrl: "dot.example.com",
  // IPv6 before IPv4, following upstream convention.
  serverAddresses: ["2001:db8::1", "2001:db8::2", "192.0.2.1", "192.0.2.2"],
  excludedWifi: [],
  excludedDomains: [],
  useWifi: true,
  useCellular: true,
  useEthernet: true,
  prohibitDisablement: false,
};

/** A valid configuration, with any field overridden. */
export function config(overrides: Partial<DnsConfig> = {}): DnsConfig {
  return { ...BASE, ...overrides };
}

/**
 * Every feature the builder can emit, in one profile. The upstream fixture
 * corpus reaches none of the on-demand or post-14.0 keys, so the golden test
 * would otherwise lock only the narrow subset those profiles happen to use.
 */
export function fullSurfaceConfigs(): DnsConfig[] {
  return [
    {
      name: "Everything & <more>",
      protocol: "HTTPS",
      serverUrl: "https://dns.example.com/dns-query",
      serverAddresses: ["2001:db8::1", "192.0.2.1"],
      excludedWifi: ["Home", "Silence of the LANs"],
      excludedDomains: ["example.com", "internal.lan"],
      useWifi: true,
      useCellular: true,
      useEthernet: true,
      prohibitDisablement: true,
      allowFailover: true,
      supplementalMatchDomains: ["*.corp.example", "internal.lan"],
    },
    {
      name: "Minimal DoT",
      protocol: "TLS",
      serverUrl: "dot.example.com",
      serverAddresses: [],
      excludedWifi: [],
      excludedDomains: [],
      useWifi: true,
      useCellular: false,
      useEthernet: false,
      prohibitDisablement: false,
    },
  ];
}
