/**
 * Domain types for the pure core.
 */

export type DnsProtocol = "HTTPS" | "TLS";

export interface DnsConfig {
  readonly name: string;
  readonly protocol: DnsProtocol;
  readonly serverUrl: string;
  readonly serverAddresses: readonly string[];
  readonly excludedWifi: readonly string[];
  readonly excludedDomains: readonly string[];
  readonly useWifi: boolean;
  readonly useCellular: boolean;
  readonly useEthernet: boolean;
  readonly prohibitDisablement: boolean;

  /** Falls back to the system resolver. Needs iOS 26, macOS 26 or visionOS 26. */
  readonly allowFailover?: boolean;

  /** Limits the resolver to these domains. A single leading `*` is allowed. */
  readonly supplementalMatchDomains?: readonly string[];
}

export interface ProfileOptions {
  readonly systemScope: boolean;
  readonly identifierPrefix?: string;
}

export type UuidFactory = () => string;
