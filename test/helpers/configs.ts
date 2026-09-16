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
