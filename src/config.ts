/**
 * Deployment settings.
 */

import type { DnsProtocol } from "./lib/types.ts";

/** A provider the tool page offers as a one-click starting point. */
export interface DnsPreset {
  readonly name: string;
  readonly protocol: DnsProtocol;
  readonly serverUrl: string;
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
   * name, protocol and server; resolver addresses are left to the user.
   * `test/config.test.ts` checks every server against the form's own rules.
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
    },
    {
      name: "njal.la",
      protocol: "HTTPS",
      serverUrl: "https://dns.njal.la/dns-query",
    },
    {
      name: "FlokiNET",
      protocol: "HTTPS",
      serverUrl: "https://resolv.flokinet.net/dns-query",
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
    },
    {
      name: "DigitaleGesellschaft",
      protocol: "HTTPS",
      serverUrl: "https://dns.digitale-gesellschaft.ch/dns-query",
    },
  ],
};
