import type { DnsConfig } from "./types.ts";

export function settingsKey(config: DnsConfig): string {
  const { paradigm: _paradigm, source: _source, ...settings } = config;
  return JSON.stringify(settings, Object.keys(settings).sort());
}

export function sameSettings(a: DnsConfig, b: DnsConfig): boolean {
  return settingsKey(a) === settingsKey(b);
}

export function distinctSettings(configs: readonly DnsConfig[]): DnsConfig[] {
  const seen = new Set<string>();
  return configs.filter((config) => {
    const key = settingsKey(config);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
