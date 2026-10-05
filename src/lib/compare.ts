import type { DnsConfig } from "./types.ts";

export type SettingsField = Exclude<keyof DnsConfig, "paradigm" | "source">;

export interface CompareRow {
  readonly field: SettingsField;
  readonly left: unknown;
  readonly right: unknown;
  readonly differs: boolean;
}

const FIELDS: readonly SettingsField[] = [
  "name",
  "protocol",
  "serverUrl",
  "serverAddresses",
  "excludedWifi",
  "excludedDomains",
  "supplementalMatchDomains",
  "useWifi",
  "useCellular",
  "useEthernet",
  "allowFailover",
  "prohibitDisablement",
];

function valueOf(config: DnsConfig, field: SettingsField): unknown {
  switch (field) {
    case "allowFailover":
      return config.allowFailover === true;
    case "supplementalMatchDomains":
      return config.supplementalMatchDomains ?? [];
    default:
      return config[field];
  }
}

export function compareConfigs(a: DnsConfig, b: DnsConfig): CompareRow[] {
  return FIELDS.map((field) => {
    const left = valueOf(a, field);
    const right = valueOf(b, field);
    return {
      field,
      left,
      right,
      differs: JSON.stringify(left) !== JSON.stringify(right),
    };
  });
}

export function shortHash(sha256: string): string {
  return sha256.slice(0, 8);
}
