/**
 * Persists configurations between the tool page and the profile page.
 */

import type { DnsConfig, DnsProtocol } from "../lib/types.ts";

const CONFIGS_KEY = "dns-mobileconfig:configs:v1";
const EDIT_INDEX_KEY = "dns-mobileconfig:edit-index";

export interface ConfigStore {
  list(): DnsConfig[];
  add(config: DnsConfig): void;
  replace(index: number, config: DnsConfig): void;
  remove(index: number): void;
  clear(): void;
  takeEditIndex(): number | undefined;
  setEditIndex(index: number): void;
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((v) => typeof v === "string");
}

function isProtocol(value: unknown): value is DnsProtocol {
  return value === "HTTPS" || value === "TLS";
}

function isDnsConfig(value: unknown): value is DnsConfig {
  if (typeof value !== "object" || value === null) return false;
  const c = value as Record<string, unknown>;
  return (
    typeof c["name"] === "string" &&
    isProtocol(c["protocol"]) &&
    typeof c["serverUrl"] === "string" &&
    isStringArray(c["serverAddresses"]) &&
    isStringArray(c["excludedWifi"]) &&
    isStringArray(c["excludedDomains"]) &&
    typeof c["useWifi"] === "boolean" &&
    typeof c["useCellular"] === "boolean" &&
    typeof c["useEthernet"] === "boolean" &&
    typeof c["prohibitDisablement"] === "boolean"
  );
}

export function createConfigStore(storage: Storage): ConfigStore {
  function read(): DnsConfig[] {
    const raw = storage.getItem(CONFIGS_KEY);
    if (raw === null) return [];

    let decoded: unknown;
    try {
      decoded = JSON.parse(raw);
    } catch {
      return [];
    }
    if (!Array.isArray(decoded)) return [];
    return decoded.filter(isDnsConfig);
  }

  function write(configs: readonly DnsConfig[]): void {
    storage.setItem(CONFIGS_KEY, JSON.stringify(configs));
  }

  return {
    list: read,

    add(config) {
      write([...read(), config]);
    },

    replace(index, config) {
      const configs = read();
      if (index < 0 || index >= configs.length) return;
      configs[index] = config;
      write(configs);
    },

    remove(index) {
      const configs = read();
      if (index < 0 || index >= configs.length) return;
      configs.splice(index, 1);
      write(configs);
    },

    clear() {
      storage.removeItem(CONFIGS_KEY);
      storage.removeItem(EDIT_INDEX_KEY);
    },

    takeEditIndex() {
      const raw = storage.getItem(EDIT_INDEX_KEY);
      storage.removeItem(EDIT_INDEX_KEY);
      if (raw === null) return undefined;
      const index = Number.parseInt(raw, 10);
      return Number.isInteger(index) && index >= 0 ? index : undefined;
    },

    setEditIndex(index) {
      storage.setItem(EDIT_INDEX_KEY, String(index));
    },
  };
}
