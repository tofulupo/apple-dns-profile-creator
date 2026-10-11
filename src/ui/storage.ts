import { settingsKey } from "../lib/settings.ts";
import type {
  ConfigSource,
  DnsConfig,
  DnsProtocol,
  ProfileFormat,
} from "../lib/types.ts";
import { tell } from "./dialogs.ts";

export const KEY_PREFIX = "dns-mobileconfig:";
const CONFIGS_KEY = `${KEY_PREFIX}configs:v1`;
const EDIT_TARGET_KEY = `${KEY_PREFIX}edit-target`;
const IMPORT_WARNINGS_KEY = `${KEY_PREFIX}import-warnings`;
export const NEUTRAL_NAME_KEY = `${KEY_PREFIX}neutral-name`;
/** Also hardcoded in the layout's inline script; the markup test checks both. */
export const THEME_KEY = `${KEY_PREFIX}theme`;
/** Also hardcoded in the layout's inline script; the markup test checks both. */
export const PIXEL_KEY = `${KEY_PREFIX}pixel`;
/** Also hardcoded in the layout's inline script; the markup test checks both. */
export const SETTINGS_KEY = `${KEY_PREFIX}settings:v1`;
/**
 * In sessionStorage, once the app has put its saved theme and motion into a
 * window (src-tauri/src/app_settings.rs); a test checks both.
 */
export const SEEDED_KEY = `${KEY_PREFIX}seeded`;

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

/**
 * On the website, in localStorage while the user keeps their data. Missing
 * means "Forget on close": everything lives in sessionStorage, which goes
 * with the tab. Also read by pages/_prepaint.html.
 */
export const KEEP_KEY = `${KEY_PREFIX}keep`;

type MovableStorage = Pick<
  Storage,
  "length" | "key" | "getItem" | "setItem" | "removeItem"
>;

export function keepsData(local: Pick<Storage, "getItem">): boolean {
  return local.getItem(KEEP_KEY) === "on";
}

/** Moves every key with the prefix but `KEEP_KEY` from one area to the other. */
export function moveKeys(from: MovableStorage, to: MovableStorage): void {
  const keys = Array.from(
    { length: from.length },
    (_, index) => from.key(index),
  )
    .filter((key): key is string =>
      key !== null && key.startsWith(KEY_PREFIX) && key !== KEEP_KEY
    );
  for (const key of keys) {
    const value = from.getItem(key);
    if (value !== null) to.setItem(key, value);
    from.removeItem(key);
  }
}

export function setKeepData(
  keep: boolean,
  local: MovableStorage,
  session: MovableStorage,
): void {
  if (keep) {
    moveKeys(session, local);
    local.setItem(KEEP_KEY, "on");
  } else {
    local.removeItem(KEEP_KEY);
    moveKeys(local, session);
  }
}

/**
 * Data an earlier version left in localStorage moves into the tab, unless the
 * user keeps their data. Runs once per page, before the first read.
 */
export function adoptEarlierData(
  local: MovableStorage,
  session: MovableStorage,
): void {
  if (!keepsData(local)) moveKeys(local, session);
}

// The app forgets on quit itself (src-tauri/src/app_settings.rs), so it
// always uses localStorage. The same check is in pages/_prepaint.html.
function inApp(): boolean {
  return "__TAURI__" in globalThis;
}

let adopted = false;

function activeStorage(): Storage {
  const local = globalThis.localStorage;
  if (inApp()) return local;
  if (!adopted) {
    adopted = true;
    try {
      adoptEarlierData(local, globalThis.sessionStorage);
    } catch {
      // Blocked storage: the reads and writes below report it.
    }
  }
  return keepsData(local) ? local : globalThis.sessionStorage;
}

export function browserStorage(): StorageArea {
  return {
    getItem: (key) => activeStorage().getItem(key),
    setItem: (key, value) => activeStorage().setItem(key, value),
    removeItem: (key) => activeStorage().removeItem(key),
  };
}

/** The website's "Forget on close" switch: true unless the user keeps data. */
export function forgetsOnClose(): boolean {
  return !inApp() && !keepsData(globalThis.localStorage);
}

export function setForgetOnClose(forget: boolean): void {
  setKeepData(!forget, globalThis.localStorage, globalThis.sessionStorage);
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
  markSaved(paradigm: ProfileFormat, source: ConfigSource): void;
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

function isParadigm(value: unknown): value is ProfileFormat {
  return value === "payload" || value === "declarations";
}

function optional<T>(guard: Guard<T>): Guard<T | undefined> {
  return (value): value is T | undefined => value === undefined || guard(value);
}

function isSource(value: unknown): value is ConfigSource {
  if (typeof value !== "object" || value === null) return false;
  const source = value as Record<string, unknown>;
  return isString(source["file"]) &&
    optional(isString)(source["profileId"]) &&
    optional(isString)(source["sha256"]) &&
    optional(isBoolean)(source["systemScope"]) &&
    optional(isBoolean)(source["edited"]);
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
  paradigm: optional(isParadigm),
  source: optional(isSource),
};

function isDnsConfig(value: unknown): value is DnsConfig {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return Object.entries(FIELD_GUARDS).every(([key, guard]) =>
    guard(record[key])
  );
}

function upgradeDeprecatedMark(value: unknown): unknown {
  if (
    typeof value !== "object" || value === null ||
    !("fromDeprecatedPayload" in value)
  ) {
    return value;
  }
  const { fromDeprecatedPayload, ...config } = value as Record<
    string,
    unknown
  >;
  return fromDeprecatedPayload === true && config["paradigm"] === undefined
    ? { ...config, paradigm: "payload" }
    : config;
}

function sourceKey(config: DnsConfig): string {
  return config.source?.sha256 ?? config.source?.file ?? "";
}

function sameConfig(a: DnsConfig, b: DnsConfig): boolean {
  return settingsKey(a) === settingsKey(b) && sourceKey(a) === sourceKey(b);
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
    return Array.isArray(decoded)
      ? decoded.map(upgradeDeprecatedMark).filter(isDnsConfig)
      : [];
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

    markSaved(paradigm, source) {
      write(read().map((config) => ({ ...config, paradigm, source })));
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
      const decoded = upgradeDeprecatedMark(take(EDIT_TARGET_KEY));
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
