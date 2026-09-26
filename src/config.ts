/**
 * Deployment settings.
 */

import type { DnsProtocol } from "./lib/types.ts";

/** A provider the tool page offers as a one-click starting point. */
export interface DnsPreset {
  readonly name: string;
  readonly protocol: DnsProtocol;
  readonly serverUrl: string;
  /**
   * The provider's resolver IPs, IPv6 first if preferred, from the provider's
   * own documentation. Optional: without them the field is left empty.
   */
  readonly serverAddresses?: readonly string[];
}

export interface AppConfig {
  /**
   * Reverse-DNS namespace for the generated profile's `PayloadIdentifier`.
   */
  readonly identifierPrefix: string;

  /** File name offered when the profile is downloaded. */
  readonly profileFilename: string;

  /** File name for a profile signed in the desktop app. */
  readonly signedProfileFilename: string;

  /**
   * Whether "Use system scope" starts ticked.
   *
   * Required on macOS 26 and later, so it defaults to on.
   */
  readonly systemScopeByDefault: boolean;

  /**
   * Quick presets above the provider name, at most six. Each fills in the
   * name, protocol, server and, when given, the resolver addresses.
   * `test/config.test.ts` checks every server and address against the
   * form's own rules.
   */
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
      serverUrl: "https://dns11.quad9.net/dns-query",
      serverAddresses: [
        "9.9.9.11",
        "149.112.112.11",
        "2620:fe::11",
        "2620:fe::fe:11",
      ],
    },
    {
      name: "njal.la",
      protocol: "HTTPS",
      serverUrl: "https://dns.njal.la/dns-query",
      serverAddresses: ["95.215.19.53", "2001:67c:2354:2::53"],
    },
    {
      name: "FlokiNET",
      protocol: "HTTPS",
      serverUrl: "https://resolv.flokinet.net/dns-query",
      serverAddresses: ["37.156.68.20", "2a06:1700:100:20::1"],
    },
    {
      name: "HaGeZi",
      protocol: "HTTPS",
      serverUrl: "https://juuri.hagezi.org/dns-query",
    },
    {
      name: "DNSBunker",
      protocol: "HTTPS",
      serverUrl: "https://dnsbunker.org/dns-query",
      serverAddresses: ["185.250.250.61", "2a0a:51c1:a:ea::"],
    },
    {
      name: "DigitaleGesellschaft",
      protocol: "HTTPS",
      serverUrl: "https://dns.digitale-gesellschaft.ch/dns-query",
    },
  ],
};
