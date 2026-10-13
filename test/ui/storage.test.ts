import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  adoptEarlierData,
  chooseDeclarations,
  createConfigStore,
  declarationsChosen,
  KEEP_KEY,
  keepsData,
  pickStorage,
  setKeepData,
  StorageUnavailableError,
} from "../../src/ui/storage.ts";
import type { ConfigStore, StorageArea } from "../../src/ui/storage.ts";
import { config } from "../helpers/configs.ts";

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
    store.setImportFacts({
      file: "a.mobileconfig",
      configs: 2,
      signature: "none",
      legacy: true,
      dot: 0,
      mullvad: false,
      leftOut: ["Left out a rule."],
    });
    store.clear();
    expect(store.list()).toEqual([]);
    expect(store.takeEditTarget()).toBeUndefined();
    expect(store.takeImportFacts()).toBeUndefined();
  });

  it("tells whether an equal entry is stored", () => {
    const stored = config({ name: "Stored" });
    store.add(stored);
    expect(store.has(config({ name: "Stored" }))).toBe(true);
    expect(store.has(config({ name: "Other" }))).toBe(false);
  });

  it("ignores the paradigm when comparing", () => {
    store.add(config({ name: "Stored", paradigm: "payload" }));
    expect(store.has(config({ name: "Stored" }))).toBe(true);
    store.update(config({ name: "Stored" }), config({ name: "Updated" }));
    expect(store.list().map((c) => c.name)).toEqual(["Updated"]);
  });

  it("tells the same settings from another file apart by its hash", () => {
    const quad9 = config({ name: "Quad9" });
    store.add({
      ...quad9,
      source: { file: "encrypted-dns.mobileconfig", sha256: "aa" },
    });
    expect(store.has({
      ...quad9,
      source: { file: "renamed.mobileconfig", sha256: "aa" },
    })).toBe(true);
    expect(store.has({
      ...quad9,
      source: { file: "encrypted-dns.mobileconfig", sha256: "bb" },
    })).toBe(false);
    expect(store.has(quad9)).toBe(false);
  });

  it("goes by the file name when there is no hash", () => {
    const quad9 = config({ name: "Quad9" });
    store.add({ ...quad9, source: { file: "a.mobileconfig" } });
    expect(store.has({ ...quad9, source: { file: "a.mobileconfig" } }))
      .toBe(true);
    expect(store.has({ ...quad9, source: { file: "a 2.mobileconfig" } }))
      .toBe(false);
  });

  it("keeps where an entry came from, and drops a source it cannot read", () => {
    const source = {
      file: "a.mobileconfig",
      profileId: "local.encrypted-dns.1",
      sha256: "aa",
      systemScope: true,
      edited: true,
    };
    storage.raw(
      CONFIGS_KEY,
      JSON.stringify([
        config({ name: "Kept", source }),
        { ...config({ name: "Broken" }), source: { file: 1 } },
      ]),
    );
    expect(store.list()).toEqual([config({ name: "Kept", source })]);
  });

  it("marks every entry as saved, duplicates included, edits cleared", () => {
    store.add(
      config({ name: "Twin" }),
      config({ name: "Twin" }),
      config({
        name: "Imported",
        paradigm: "payload",
        source: { file: "quad9-signed.mobileconfig", edited: true },
      }),
    );
    const saved = {
      file: "quad9.mobileconfig",
      profileId: "local.encrypted-dns.1",
      sha256: "aa",
      systemScope: true,
    };
    store.markSaved("declarations", saved);
    expect(store.list().map((c) => [c.paradigm, c.source])).toEqual([
      ["declarations", saved],
      ["declarations", saved],
      ["declarations", saved],
    ]);
  });

  it("reads the old deprecated mark as the legacy paradigm", () => {
    storage.raw(
      CONFIGS_KEY,
      JSON.stringify([
        { ...config({ name: "Old" }), fromDeprecatedPayload: true },
        { ...config({ name: "Plain" }), fromDeprecatedPayload: false },
      ]),
    );
    expect(store.list()).toEqual([
      config({ name: "Old", paradigm: "payload" }),
      config({ name: "Plain" }),
    ]);
  });
});

describe("changes made in another tab meanwhile", () => {
  it("update the edited entry even after it moved", () => {
    const edited = config({ name: "Edited" });
    const other = config({ name: "Other" });
    store.add(other, edited);
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
    expect(blocked.takeImportFacts()).toBeUndefined();
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

describe("what an import found", () => {
  const facts = {
    file: "office.mobileconfig",
    configs: 2,
    signature: "unchecked",
    legacy: true,
    dot: 1,
    mullvad: false,
    leftOut: ["First.", "Second, with a comma."],
  } as const;

  it("is undefined when unset", () => {
    expect(store.takeImportFacts()).toBeUndefined();
  });

  it("is handed over exactly once, the left-out lines in order", () => {
    store.setImportFacts(facts);
    expect(store.takeImportFacts()).toEqual(facts);
    expect(store.takeImportFacts()).toBeUndefined();
  });

  it("replaces what an earlier import found", () => {
    store.setImportFacts({ ...facts, leftOut: ["Stale."] });
    const next = {
      ...facts,
      signature: "none",
      legacy: false,
      leftOut: [],
    } as const;
    store.setImportFacts(next);
    expect(store.takeImportFacts()).toEqual(next);
  });

  it("is undefined for corrupt data and the warnings of earlier versions", () => {
    for (
      const raw of [
        "{not json",
        '["Left out resolver addresses."]',
        '{"file":"a","configs":2,"signature":"verified","legacy":false,"leftOut":[]}',
        '{"file":"a","configs":2,"signature":"none","legacy":false,"leftOut":[1]}',
        '{"signature":"none","legacy":false,"leftOut":[]}',
      ]
    ) {
      storage.raw("dns-mobileconfig:import-warnings", raw);
      expect(store.takeImportFacts()).toBeUndefined();
    }
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

describe("the Declaration format switch", () => {
  it("is off until chosen", () => {
    expect(declarationsChosen(storage)).toBe(false);
  });

  it("keeps being turned on and off", () => {
    chooseDeclarations(true, storage);
    expect(declarationsChosen(storage)).toBe(true);
    chooseDeclarations(false, storage);
    expect(declarationsChosen(storage)).toBe(false);
    expect(storage.length).toBe(0);
  });

  it("stays off and quiet when the browser refuses storage", () => {
    const refusing: StorageArea = {
      getItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      setItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
      removeItem: () => {
        throw new DOMException("denied", "SecurityError");
      },
    };
    expect(() => chooseDeclarations(true, refusing)).not.toThrow();
    expect(declarationsChosen(refusing)).toBe(false);
  });

  it("moves with the cards when the user keeps or forgets data", () => {
    const local = new FakeStorage();
    const session = new FakeStorage();
    chooseDeclarations(true, session);
    setKeepData(true, local, session);
    expect(declarationsChosen(local)).toBe(true);
    expect(declarationsChosen(session)).toBe(false);
  });
});

describe("forgetting on close or keeping", () => {
  let local: FakeStorage;
  let session: FakeStorage;
  const keys = (area: FakeStorage) =>
    Array.from({ length: area.length }, (_, index) => area.key(index)).sort();

  beforeEach(() => {
    local = new FakeStorage();
    session = new FakeStorage();
  });

  it("forgets unless the user keeps their data", () => {
    expect(keepsData(local)).toBe(false);
    setKeepData(true, local, session);
    expect(keepsData(local)).toBe(true);
  });

  it("moves everything into the browser when keeping is turned on", () => {
    session.setItem(CONFIGS_KEY, "[]");
    session.setItem("dns-mobileconfig:theme", "dark");
    setKeepData(true, local, session);
    expect(keys(session)).toEqual([]);
    expect(keys(local)).toEqual([
      CONFIGS_KEY,
      KEEP_KEY,
      "dns-mobileconfig:theme",
    ]);
  });

  it("moves everything back into the tab, the switch included, when turned off", () => {
    setKeepData(true, local, session);
    local.setItem(CONFIGS_KEY, "[]");
    setKeepData(false, local, session);
    expect(keys(local)).toEqual([]);
    expect(keys(session)).toEqual([CONFIGS_KEY]);
  });

  it("never touches keys of other sites or apps", () => {
    local.setItem("other-app:token", "x");
    session.setItem("other-app:draft", "y");
    setKeepData(true, local, session);
    setKeepData(false, local, session);
    expect(local.getItem("other-app:token")).toBe("x");
    expect(session.getItem("other-app:draft")).toBe("y");
  });

  it("loads cards an earlier version kept, and then keeps them only in the tab", () => {
    local.setItem(CONFIGS_KEY, "[1]");
    adoptEarlierData(local, session);
    expect(session.getItem(CONFIGS_KEY)).toBe("[1]");
    expect(local.getItem(CONFIGS_KEY)).toBeNull();
  });

  it("writes into the tab while forgetting is on, and nothing into the browser", () => {
    createConfigStore(pickStorage(local, session, false)).add(config());
    expect(keys(session)).toEqual([CONFIGS_KEY]);
    expect(keys(local)).toEqual([]);
  });

  it("writes into the browser once the user keeps their data", () => {
    setKeepData(true, local, session);
    createConfigStore(pickStorage(local, session, false)).add(config());
    expect(keys(local)).toEqual([CONFIGS_KEY, KEEP_KEY]);
    expect(keys(session)).toEqual([]);
  });

  it("always writes into the browser in the app, which forgets on quit itself", () => {
    createConfigStore(pickStorage(local, session, true)).add(config());
    expect(keys(local)).toEqual([CONFIGS_KEY]);
    expect(keys(session)).toEqual([]);
  });

  it("leaves the data in the browser when the user keeps it", () => {
    setKeepData(true, local, session);
    local.setItem(CONFIGS_KEY, "[1]");
    adoptEarlierData(local, session);
    expect(local.getItem(CONFIGS_KEY)).toBe("[1]");
    expect(keys(session)).toEqual([]);
  });
});
