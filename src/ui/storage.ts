import type { DnsConfig, DnsProtocol } from "../lib/types.ts";
import { tell } from "./dialogs.ts";

export const KEY_PREFIX = "dns-mobileconfig:";
const CONFIGS_KEY = `${KEY_PREFIX}configs:v1`;
const EDIT_TARGET_KEY = `${KEY_PREFIX}edit-target`;
const IMPORT_WARNINGS_KEY = `${KEY_PREFIX}import-warnings`;
/** Also hardcoded in the layout's inline script; the markup test checks both. */
export const THEME_KEY = `${KEY_PREFIX}theme`;
/** Also hardcoded in the layout's inline script; the markup test checks both. */
export const PIXEL_KEY = `${KEY_PREFIX}pixel`;
/** Also hardcoded in the layout's inline script; the markup test checks both. */
export const SETTINGS_KEY = `${KEY_PREFIX}settings:v1`;

export type StorageArea = Pick<Storage, "getItem" | "setItem" | "removeItem">;

export class StorageUnavailableError extends Error {
  constructor(options?: ErrorOptions) {
    super(
      "The browser refused to save your configurations. Allow this site to " +
        "store data (private browsing and strict privacy settings block it), " +
        "then try again.",
      options,
    );
    this.name = "StorageUnavailableError";
  }
}

export function browserStorage(): StorageArea {
  return {
    getItem: (key) => globalThis.localStorage.getItem(key),
    setItem: (key, value) => globalThis.localStorage.setItem(key, value),
    removeItem: (key) => globalThis.localStorage.removeItem(key),
  };
}

export function persist(write: () => void): boolean {
  try {
    write();
    return true;
  } catch (error) {
    if (!(error instanceof StorageUnavailableError)) throw error;
    void tell(error.message);
    return false;
  }
}

export interface ConfigStore {
  list(): DnsConfig[];
  has(config: DnsConfig): boolean;
  add(...configs: readonly DnsConfig[]): void;
  update(original: DnsConfig, next: DnsConfig): void;
  remove(config: DnsConfig): void;
  clear(): void;
  startEdit(config: DnsConfig): void;
  takeEditTarget(): DnsConfig | undefined;
  setImportWarnings(warnings: readonly string[]): void;
  takeImportWarnings(): string[];
  subscribe(listener: () => void): void;
}

type Guard<T> = (value: unknown) => value is T;

function isString(value: unknown): value is string {
  return typeof value === "string";
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === "boolean";
}

function isStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every(isString);
}

function isProtocol(value: unknown): value is DnsProtocol {
  return value === "HTTPS" || value === "TLS";
}

function optional<T>(guard: Guard<T>): Guard<T | undefined> {
  return (value): value is T | undefined => value === undefined || guard(value);
}

const FIELD_GUARDS: {
  readonly [K in keyof DnsConfig]-?: Guard<DnsConfig[K]>;
} = {
  name: isString,
  protocol: isProtocol,
  serverUrl: isString,
  serverAddresses: isStringArray,
  excludedWifi: isStringArray,
  excludedDomains: isStringArray,
  useWifi: isBoolean,
  useCellular: isBoolean,
  useEthernet: isBoolean,
  prohibitDisablement: isBoolean,
  allowFailover: optional(isBoolean),
  supplementalMatchDomains: optional(isStringArray),
  fromDeprecatedPayload: optional(isBoolean),
};

function isDnsConfig(value: unknown): value is DnsConfig {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Object.entries(FIELD_GUARDS).every(([key, guard]) =>
    guard(record[key])
  );
}

function sameConfig(a: DnsConfig, b: DnsConfig): boolean {
  const canonical = (
    { fromDeprecatedPayload: _source, ...config }: DnsConfig,
  ) => JSON.stringify(config, Object.keys(config).sort());
  return canonical(a) === canonical(b);
}

function decodeJson(raw: string | null): unknown {
  if (raw === null) return undefined;
  try {
    return JSON.parse(raw);
  } catch {
    return undefined;
  }
}

export function createConfigStore(storage: StorageArea): ConfigStore {
  function get(key: string): string | null {
    try {
      return storage.getItem(key);
    } catch {
      return null;
    }
  }

  function set(key: string, value: string): void {
    try {
      storage.setItem(key, value);
    } catch (error) {
      throw new StorageUnavailableError({ cause: error });
    }
  }

  function unset(key: string): void {
    try {
      storage.removeItem(key);
    } catch (error) {
      throw new StorageUnavailableError({ cause: error });
    }
  }

  function take(key: string): unknown {
    const decoded = decodeJson(get(key));
    try {
      storage.removeItem(key);
    } catch {
      // Nothing was readable either, so there is nothing to hand over.
    }
    return decoded;
  }

  function read(): DnsConfig[] {
    const decoded = decodeJson(get(CONFIGS_KEY));
    return Array.isArray(decoded) ? decoded.filter(isDnsConfig) : [];
  }

  function write(configs: readonly DnsConfig[]): void {
    set(CONFIGS_KEY, JSON.stringify(configs));
  }

  return {
    list: read,

    has(target) {
      return read().some((config) => sameConfig(config, target));
    },

    add(...configs) {
      write([...read(), ...configs]);
    },

    update(original, next) {
      const configs = read();
      const index = configs.findIndex((config) => sameConfig(config, original));
      if (index < 0) configs.push(next);
      else configs[index] = next;
      write(configs);
    },

    remove(target) {
      const configs = read();
      const index = configs.findIndex((config) => sameConfig(config, target));
      if (index < 0) return;
      configs.splice(index, 1);
      write(configs);
    },

    clear() {
      unset(CONFIGS_KEY);
      unset(EDIT_TARGET_KEY);
      unset(IMPORT_WARNINGS_KEY);
    },

    startEdit(config) {
      set(EDIT_TARGET_KEY, JSON.stringify(config));
    },

    takeEditTarget() {
      const decoded = take(EDIT_TARGET_KEY);
      return isDnsConfig(decoded) ? decoded : undefined;
    },

    setImportWarnings(warnings) {
      if (warnings.length === 0) unset(IMPORT_WARNINGS_KEY);
      else set(IMPORT_WARNINGS_KEY, JSON.stringify(warnings));
    },

    takeImportWarnings() {
      const decoded = take(IMPORT_WARNINGS_KEY);
      return isStringArray(decoded) ? decoded : [];
    },

    subscribe(listener) {
      globalThis.addEventListener("storage", (event) => {
        if (event.key === null || event.key === CONFIGS_KEY) listener();
      });
    },
  };
}
