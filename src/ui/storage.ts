/**
 * Persists configurations between the tool page and the profile page.
 */

import type { DnsConfig, DnsProtocol } from "../lib/types.ts";

const CONFIGS_KEY = "dns-mobileconfig:configs:v1";
const EDIT_TARGET_KEY = "dns-mobileconfig:edit-target";
const IMPORT_WARNINGS_KEY = "dns-mobileconfig:import-warnings";

/** The part of `Storage` the app uses, so tests and stand-ins stay small. */
export type StorageArea = Pick<Storage, "getItem" | "setItem" | "removeItem">;

/** A write the browser refused: storage disabled, blocked, or full. */
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

/**
 * `localStorage`, looked up on every call. Merely reading the global throws
 * a SecurityError when the browser blocks storage, which at module level
 * would stop the whole page; deferred, it becomes an error the store handles.
 */
export function browserStorage(): StorageArea {
  const area = (): Storage => globalThis.localStorage;
  return {
    getItem: (key) => area().getItem(key),
    setItem: (key, value) => area().setItem(key, value),
    removeItem: (key) => area().removeItem(key),
  };
}

/**
 * Runs a store write, and tells the user when the browser refused it.
 * Returns whether the write happened, so the caller can stay put if not.
 */
export function persist(write: () => void): boolean {
  try {
    write();
    return true;
  } catch (error) {
    if (!(error instanceof StorageUnavailableError)) throw error;
    alert(error.message);
    return false;
  }
}

/**
 * Entries are addressed by content rather than list position: another tab
 * can add or delete in between, and a stale index would then edit or delete
 * the wrong configuration. Identical entries are interchangeable, so matching
 * the first equal one is always right.
 */
export interface ConfigStore {
  list(): DnsConfig[];
  /** Appends in one write, so a refused write leaves none of them behind. */
  add(...configs: readonly DnsConfig[]): void;
  /** Replaces the entry equal to `original`; appends when it has gone. */
  update(original: DnsConfig, next: DnsConfig): void;
  /** Removes the entry equal to `config`, if there still is one. */
  remove(config: DnsConfig): void;
  clear(): void;
  /** Hands the configuration to edit to the tool page, which takes it once. */
  startEdit(config: DnsConfig): void;
  takeEditTarget(): DnsConfig | undefined;
  /** Hands an import's warnings to the next page, which takes them once. */
  setImportWarnings(warnings: readonly string[]): void;
  takeImportWarnings(): string[];
  /** Calls `listener` when another tab changes the list. */
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

/**
 * One guard per field. Typed against `DnsConfig`, so a field added there
 * without a guard here, or a new required field given an `optional` guard,
 * is a compile error rather than silently unchecked stored data.
 */
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
  // Added after v1 shipped. Absent in stored entries, so optional here; the
  // shape stays a superset and needs no migration.
  allowFailover: optional(isBoolean),
  supplementalMatchDomains: optional(isStringArray),
};

function isDnsConfig(value: unknown): value is DnsConfig {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Object.entries(FIELD_GUARDS).every(([key, guard]) =>
    guard(record[key])
  );
}

/** Content equality, independent of the order keys were written in. */
function sameConfig(a: DnsConfig, b: DnsConfig): boolean {
  const canonical = (config: DnsConfig) =>
    JSON.stringify(config, Object.keys(config).sort());
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
  /** Unreadable storage reads as empty, so the pages still render. */
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

  /** Reads a hand-over key once. Failing to delete it is harmless. */
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
      // Fired only in other tabs; `key` is null when storage was cleared.
      globalThis.addEventListener("storage", (event) => {
        if (event.key === null || event.key === CONFIGS_KEY) listener();
      });
    },
  };
}
