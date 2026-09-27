/**
 * Tests for keeping stored data across desktop app launches.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  type EnumerableStorage,
  snapshot,
  syncStorage,
} from "../../src/ui/desktop_storage.ts";
import { RESTORED_KEY, THEME_KEY } from "../../src/ui/storage.ts";

/** A Map-backed stand-in for sessionStorage. */
function memoryStorage(
  entries: Record<string, string> = {},
): EnumerableStorage & { entries(): Record<string, string> } {
  const map = new Map(Object.entries(entries));
  return {
    get length() {
      return map.size;
    },
    key: (index) => [...map.keys()][index] ?? null,
    getItem: (key) => map.get(key) ?? null,
    setItem: (key, value) => void map.set(key, value),
    removeItem: (key) => void map.delete(key),
    entries: () => Object.fromEntries(map),
  };
}

/** Records every save; `loadStorage` returns `file`. */
function fakeBindings(file: Record<string, string> = {}) {
  const saves: Record<string, string>[] = [];
  return {
    saves,
    loadStorage: () => Promise.resolve(file),
    saveStorage: (data: Record<string, string>) => {
      saves.push(data);
      return Promise.resolve();
    },
  };
}

const CONFIGS = "dns-mobileconfig:configs:v1";
const SIGN_WITH = "dns-mobileconfig:sign-with";

describe("snapshot", () => {
  it("keeps configurations and the signing choice only", () => {
    const storage = memoryStorage({
      [CONFIGS]: "[]",
      [SIGN_WITH]: "ABC",
      [THEME_KEY]: "dark",
      [RESTORED_KEY]: "1",
      "dns-mobileconfig:edit-target": "{}",
      "dns-mobileconfig:import-warnings": "[]",
      "other-app:key": "value",
    });
    expect(snapshot(storage)).toEqual({ [CONFIGS]: "[]", [SIGN_WITH]: "ABC" });
  });
});

describe("syncStorage", () => {
  it("restores the file on the first page of a launch", async () => {
    const storage = memoryStorage();
    const bindings = fakeBindings({ [CONFIGS]: "[1]", [SIGN_WITH]: "ABC" });
    await syncStorage(storage, bindings);
    expect(storage.entries()).toEqual({
      [CONFIGS]: "[1]",
      [SIGN_WITH]: "ABC",
      [RESTORED_KEY]: "1",
    });
    expect(bindings.saves).toEqual([]);
  });

  it("does not restore a theme, even one in the file", async () => {
    const storage = memoryStorage();
    await syncStorage(storage, fakeBindings({ [THEME_KEY]: "dark" }));
    expect(storage.getItem(THEME_KEY)).toBeNull();
  });

  it("brings the file up to date on later pages instead", async () => {
    const storage = memoryStorage({
      [RESTORED_KEY]: "1",
      [CONFIGS]: "[current]",
    });
    const bindings = fakeBindings({ [CONFIGS]: "[stale]" });
    await syncStorage(storage, bindings);
    expect(storage.getItem(CONFIGS)).toBe("[current]");
    expect(bindings.saves).toEqual([{ [CONFIGS]: "[current]" }]);
  });

  it("saves the latest state, in order", async () => {
    const storage = memoryStorage();
    const bindings = fakeBindings();
    const save = await syncStorage(storage, bindings);
    storage.setItem(CONFIGS, "[1]");
    const first = save();
    storage.setItem(SIGN_WITH, "ABC");
    await Promise.all([first, save()]);
    expect(bindings.saves.at(-1)).toEqual({
      [CONFIGS]: "[1]",
      [SIGN_WITH]: "ABC",
    });
  });

  it("keeps saving after a failed save", async () => {
    const storage = memoryStorage();
    const bindings = fakeBindings();
    let fail = true;
    const save = await syncStorage(storage, {
      loadStorage: bindings.loadStorage,
      saveStorage: (data) => {
        if (fail) {
          fail = false;
          return Promise.reject(new Error("disk full"));
        }
        return bindings.saveStorage(data);
      },
    });
    await expect(save()).rejects.toThrow("disk full");
    storage.setItem(CONFIGS, "[1]");
    await save();
    expect(bindings.saves).toEqual([{ [CONFIGS]: "[1]" }]);
  });
});
