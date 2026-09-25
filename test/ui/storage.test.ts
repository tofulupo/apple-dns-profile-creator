/**
 * Tests for the configuration store that replaced the cookie jar.
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  createConfigStore,
  StorageUnavailableError,
} from "../../src/ui/storage.ts";
import type { ConfigStore, StorageArea } from "../../src/ui/storage.ts";
import { config } from "../helpers/configs.ts";

/** Minimal in-memory `Storage`. */
class FakeStorage implements Storage {
  #entries = new Map<string, string>();

  get length(): number {
    return this.#entries.size;
  }

  clear(): void {
    this.#entries.clear();
  }

  getItem(key: string): string | null {
    return this.#entries.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.#entries.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.#entries.delete(key);
  }

  setItem(key: string, value: string): void {
    this.#entries.set(key, String(value));
  }

  /** Lets a test plant corrupt data. */
  raw(key: string, value: string): void {
    this.#entries.set(key, value);
  }
}

const CONFIGS_KEY = "dns-mobileconfig:configs:v1";

let storage: FakeStorage;
let store: ConfigStore;

beforeEach(() => {
  storage = new FakeStorage();
  store = createConfigStore(storage);
});

describe("configuration list", () => {
  it("starts empty", () => {
    expect(store.list()).toEqual([]);
  });

  it("appends in order", () => {
    store.add(config({ name: "First" }));
    store.add(config({ name: "Second" }));
    expect(store.list().map((c) => c.name)).toEqual(["First", "Second"]);
  });

  it("round-trips every field", () => {
    const original = config({
      name: "Example",
      protocol: "HTTPS",
      serverUrl: "https://dns.example/query",
      serverAddresses: ["2001:db8::1", "192.0.2.1"],
      excludedWifi: ["Home"],
      excludedDomains: ["internal.lan"],
      useWifi: true,
      useCellular: false,
      useEthernet: true,
      prohibitDisablement: true,
    });
    store.add(original);
    expect(store.list()[0]).toEqual(original);
  });

  it("appends several in order", () => {
    store.add(config({ name: "First" }), config({ name: "Second" }));
    expect(store.list().map((c) => c.name)).toEqual(["First", "Second"]);
  });

  it("updates an entry in place without reordering", () => {
    const first = config({ name: "First" });
    store.add(first, config({ name: "Second" }));
    store.update(first, config({ name: "Replaced" }));
    expect(store.list().map((c) => c.name)).toEqual(["Replaced", "Second"]);
  });

  it("removes the matching entry and closes the gap", () => {
    const second = config({ name: "Second" });
    store.add(config({ name: "First" }), second, config({ name: "Third" }));
    store.remove(second);
    expect(store.list().map((c) => c.name)).toEqual(["First", "Third"]);
  });

  it("clears everything", () => {
    store.add(config());
    store.startEdit(config());
    store.setImportWarnings(["Left out a rule."]);
    store.clear();
    expect(store.list()).toEqual([]);
    expect(store.takeEditTarget()).toBeUndefined();
    expect(store.takeImportWarnings()).toEqual([]);
  });
});

describe("changes made in another tab meanwhile", () => {
  it("update the edited entry even after it moved", () => {
    const edited = config({ name: "Edited" });
    const other = config({ name: "Other" });
    store.add(other, edited);
    // Another tab deletes the entry before it, shifting its index.
    createConfigStore(storage).remove(other);
    store.update(edited, config({ name: "Saved" }));
    expect(store.list().map((c) => c.name)).toEqual(["Saved"]);
  });

  it("re-add an edited entry that was deleted rather than lose it", () => {
    const edited = config({ name: "Edited" });
    store.add(edited, config({ name: "Bystander" }));
    createConfigStore(storage).remove(edited);
    store.update(edited, config({ name: "Saved" }));
    expect(store.list().map((c) => c.name)).toEqual(["Bystander", "Saved"]);
  });

  it("never delete a different entry", () => {
    const gone = config({ name: "Gone" });
    store.add(gone, config({ name: "Keep" }));
    createConfigStore(storage).remove(gone);
    store.remove(gone);
    expect(store.list().map((c) => c.name)).toEqual(["Keep"]);
  });

  it("match entries whatever order their keys were stored in", () => {
    const entry = config({ name: "Reordered", allowFailover: true });
    const reversed = Object.fromEntries(Object.entries(entry).reverse());
    storage.raw(CONFIGS_KEY, JSON.stringify([reversed]));
    store.remove(entry);
    expect(store.list()).toEqual([]);
  });
});

describe("blocked or full storage", () => {
  const refusing: StorageArea = {
    getItem: () => {
      throw new DOMException("denied", "SecurityError");
    },
    setItem: () => {
      throw new DOMException("full", "QuotaExceededError");
    },
    removeItem: () => {
      throw new DOMException("denied", "SecurityError");
    },
  };

  it("reads as empty instead of throwing", () => {
    const blocked = createConfigStore(refusing);
    expect(blocked.list()).toEqual([]);
    expect(blocked.takeEditTarget()).toBeUndefined();
    expect(blocked.takeImportWarnings()).toEqual([]);
  });

  it("reports refused writes as StorageUnavailableError, with the cause", () => {
    const blocked = createConfigStore(refusing);
    let caught: unknown;
    try {
      blocked.add(config());
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(StorageUnavailableError);
    expect((caught as Error).cause).toBeInstanceOf(DOMException);
    expect(() => blocked.clear()).toThrow(StorageUnavailableError);
    expect(() => blocked.startEdit(config())).toThrow(StorageUnavailableError);
  });
});

describe("values that broke the cookie implementation", () => {
  const hostile = [
    ["a semicolon", "Provider; DROP TABLE"],
    ["a comma", "Provider, Inc."],
    ["a percent sign", "50% faster"],
    ["a percent escape", "Provider%20Name"],
    ["an equals sign", "a=b"],
    ["non-ASCII text", "Провайдер 🇺🇸"],
    ["a quote and backslash", 'He said "hi" \\ bye'],
    ["a newline", "Line one\nLine two"],
  ] as const;

  for (const [label, name] of hostile) {
    it(`survives ${label} in the provider name`, () => {
      const store = createConfigStore(new FakeStorage());
      store.add(config({ name }));
      expect(store.list()[0]?.name).toBe(name);
    });
  }

  it("survives a comma inside an SSID", () => {
    const excludedWifi = ["Home, Sweet Home", "Office"];
    store.add(config({ excludedWifi }));
    expect(store.list()[0]?.excludedWifi).toEqual(excludedWifi);
  });
});

describe("corrupt stored data", () => {
  it("falls back to empty on invalid JSON", () => {
    storage.raw(CONFIGS_KEY, "{not json");
    expect(store.list()).toEqual([]);
  });

  it("falls back to empty when the payload is not an array", () => {
    storage.raw(CONFIGS_KEY, '{"nope":true}');
    expect(store.list()).toEqual([]);
  });

  it("discards entries of the wrong shape but keeps valid ones", () => {
    const valid = config({ name: "Valid" });
    storage.raw(
      CONFIGS_KEY,
      JSON.stringify([{ name: "Half" }, valid, null, 42, "nope"]),
    );
    expect(store.list()).toEqual([valid]);
  });

  it("rejects an unknown protocol", () => {
    storage.raw(
      CONFIGS_KEY,
      JSON.stringify([{ ...config(), protocol: "CARRIER_PIGEON" }]),
    );
    expect(store.list()).toEqual([]);
  });
});

describe("fields added after v1", () => {
  it("accepts entries written before they existed", () => {
    const legacy = config();
    storage.raw(CONFIGS_KEY, JSON.stringify([legacy]));
    expect(store.list()).toEqual([legacy]);
  });

  it("round-trips them when present", () => {
    const stored = config({
      allowFailover: true,
      supplementalMatchDomains: ["*.example.com"],
    });
    store.add(stored);
    expect(store.list()).toEqual([stored]);
  });

  it("rejects entries where they have the wrong type", () => {
    storage.raw(
      CONFIGS_KEY,
      JSON.stringify([{ ...config(), allowFailover: "yes" }]),
    );
    expect(store.list()).toEqual([]);

    storage.raw(
      CONFIGS_KEY,
      JSON.stringify([{ ...config(), supplementalMatchDomains: "a,b" }]),
    );
    expect(store.list()).toEqual([]);
  });
});

describe("import warnings", () => {
  it("are empty when unset", () => {
    expect(store.takeImportWarnings()).toEqual([]);
  });

  it("are consumed exactly once, in order", () => {
    store.setImportWarnings(["First.", "Second, with a comma."]);
    expect(store.takeImportWarnings()).toEqual([
      "First.",
      "Second, with a comma.",
    ]);
    expect(store.takeImportWarnings()).toEqual([]);
  });

  it("replace earlier ones, even with none", () => {
    store.setImportWarnings(["Stale."]);
    store.setImportWarnings([]);
    expect(store.takeImportWarnings()).toEqual([]);
  });

  it("fall back to empty on corrupt data", () => {
    storage.raw("dns-mobileconfig:import-warnings", "{not json");
    expect(store.takeImportWarnings()).toEqual([]);
    storage.raw("dns-mobileconfig:import-warnings", "[1, 2]");
    expect(store.takeImportWarnings()).toEqual([]);
  });
});

describe("edit target", () => {
  it("is undefined when unset", () => {
    expect(store.takeEditTarget()).toBeUndefined();
  });

  it("is consumed exactly once", () => {
    const target = config({ name: "Target", allowFailover: true });
    store.startEdit(target);
    expect(store.takeEditTarget()).toEqual(target);
    expect(store.takeEditTarget()).toBeUndefined();
  });

  it("rejects stored data of the wrong shape", () => {
    storage.raw("dns-mobileconfig:edit-target", "banana");
    expect(store.takeEditTarget()).toBeUndefined();
    storage.raw("dns-mobileconfig:edit-target", '{"name":"Half"}');
    expect(store.takeEditTarget()).toBeUndefined();
  });
});
