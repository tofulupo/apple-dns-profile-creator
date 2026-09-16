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
}

export interface ProfileOptions {
  readonly systemScope: boolean;
  readonly identifierPrefix?: string;
}

export type UuidFactory = () => string;
