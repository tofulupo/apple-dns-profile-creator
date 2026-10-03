import type { DnsProtocol } from "./lib/types.ts";

export type PresetFeature = "no-logs" | "ads" | "dnssec" | "blocking";

export const PRESET_FEATURE_LABELS: Readonly<Record<PresetFeature, string>> = {
  "no-logs": "No logs",
  dnssec: "DNSSEC",
  ads: "Ad blocking",
  blocking: "Malware blocking",
};

export interface DnsPreset {
  readonly name: string;
  readonly protocol: DnsProtocol;
  readonly serverUrl: string;
  /** At most two IPv4 then at most two IPv6, as the form keeps them. */
  readonly serverAddresses?: readonly string[];
  /** ISO 3166-1 alpha-2. Omitted for anycast providers. */
  readonly country?: string;
  readonly features?: readonly PresetFeature[];
}

export interface AppConfig {
  readonly identifierPrefix: string;
  readonly profileFilename: string;
  readonly signedProfileFilename: string;

  /** System scope is required on macOS 26 and later. */
  readonly systemScopeByDefault: boolean;

  /** `test/config.test.ts` checks every server and address. */
  readonly presets: readonly DnsPreset[];
}

export const appConfig: AppConfig = {
  identifierPrefix: "local.encrypted-dns.",
  profileFilename: "encrypted-dns.mobileconfig",
  signedProfileFilename: "encrypted-dns-signed.mobileconfig",
  systemScopeByDefault: true,
  presets: [
    {
      name: "Quad9",
      protocol: "HTTPS",
      serverUrl: "https://dns.quad9.net/dns-query",
      serverAddresses: [
        "9.9.9.9",
        "149.112.112.112",
        "2620:fe::fe",
        "2620:fe::9",
      ],
      features: ["dnssec", "blocking"],
    },
    {
      name: "HaGeZi",
      protocol: "HTTPS",
      serverUrl: "https://juuri.hagezi.org/dns-query",
      features: ["no-logs", "ads"],
      country: "FI",
    },
    {
      name: "njal.la",
      protocol: "HTTPS",
      serverUrl: "https://dns.njal.la/dns-query",
      serverAddresses: ["95.215.19.53", "2001:67c:2354:2::53"],
      features: ["no-logs"],
      country: "SE",
    },
    {
      name: "DNS.SB",
      protocol: "HTTPS",
      serverUrl: "https://doh.dns.sb/dns-query",
      serverAddresses: ["45.11.45.11", "185.222.222.222", "2a09::", "2a11::"],
      features: ["no-logs", "dnssec"],
    },
    {
      name: "FlokiNET",
      protocol: "HTTPS",
      serverUrl: "https://resolv.flokinet.net/dns-query",
      serverAddresses: ["37.156.68.20", "2a06:1700:100:20::1"],
      country: "IS",
      features: ["no-logs"],
    },
    {
      name: "DNS Bunker",
      protocol: "HTTPS",
      serverUrl: "https://dnsbunker.org/dns-query",
      serverAddresses: ["185.250.250.61", "2a0a:51c1:a:ea::"],
      features: ["no-logs", "dnssec", "ads"],
      country: "CH",
    },
  ],
};
