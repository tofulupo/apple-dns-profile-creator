/**
 * Tests for the configuration store that replaced the cookie jar.
 */
import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { createConfigStore } from "../../src/ui/storage.ts";
import type { ConfigStore } from "../../src/ui/storage.ts";
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

  it("replaces by index without reordering", () => {
    store.add(config({ name: "First" }));
    store.add(config({ name: "Second" }));
    store.replace(0, config({ name: "Replaced" }));
    expect(store.list().map((c) => c.name)).toEqual(["Replaced", "Second"]);
  });

  it("removes by index and closes the gap", () => {
    store.add(config({ name: "First" }));
    store.add(config({ name: "Second" }));
    store.add(config({ name: "Third" }));
    store.remove(1);
    expect(store.list().map((c) => c.name)).toEqual(["First", "Third"]);
  });

  it("ignores out-of-range writes", () => {
    store.add(config({ name: "Only" }));
    store.replace(5, config({ name: "Nope" }));
    store.remove(-1);
    store.remove(99);
    expect(store.list().map((c) => c.name)).toEqual(["Only"]);
  });

  it("clears everything", () => {
    store.add(config());
    store.setEditIndex(0);
    store.clear();
    expect(store.list()).toEqual([]);
    expect(store.takeEditIndex()).toBeUndefined();
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

describe("edit index", () => {
  it("is undefined when unset", () => {
    expect(store.takeEditIndex()).toBeUndefined();
  });

  it("is consumed exactly once", () => {
    store.setEditIndex(2);
    expect(store.takeEditIndex()).toBe(2);
    expect(store.takeEditIndex()).toBeUndefined();
  });

  it("rejects a non-numeric or negative value", () => {
    storage.raw("dns-mobileconfig:edit-index", "banana");
    expect(store.takeEditIndex()).toBeUndefined();
    storage.raw("dns-mobileconfig:edit-index", "-1");
    expect(store.takeEditIndex()).toBeUndefined();
  });
});
