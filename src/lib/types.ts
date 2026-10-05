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

  /** Needs iOS 26, macOS 26 or visionOS 26. */
  readonly allowFailover?: boolean;

  readonly supplementalMatchDomains?: readonly string[];

  readonly paradigm?: ProfileFormat;

  readonly source?: ConfigSource;
}

export interface ConfigSource {
  readonly file: string;
  readonly profileId?: string;
  readonly sha256?: string;
  readonly systemScope?: boolean;
  readonly edited?: boolean;
}

/**
 * `payload` is read by every version but deprecated in iOS 27 and macOS 27.
 * `declarations` only applies on iOS 27, macOS 27 and visionOS 27 and later.
 */
export type ProfileFormat = "payload" | "declarations";

export interface ProfileOptions {
  readonly systemScope: boolean;
  readonly identifierPrefix?: string;

  readonly format?: ProfileFormat;
}

export type UuidFactory = () => string;
