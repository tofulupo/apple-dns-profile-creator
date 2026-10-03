import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  DEFAULT_SETTINGS,
  readSettings,
  reducesMotion,
  saveSettings,
  SETTINGS_KEY,
} from "../../src/ui/settings.ts";

function storage(value: string | null): Pick<Storage, "getItem"> {
  return { getItem: (key) => (key === SETTINGS_KEY ? value : null) };
}

describe("readSettings", () => {
  it("defaults to following the system", () => {
    expect(readSettings(storage(null))).toEqual(DEFAULT_SETTINGS);
    expect(DEFAULT_SETTINGS.motion).toBe("system");
  });

  it("returns a stored choice", () => {
    for (const motion of ["system", "reduce", "full"]) {
      expect(readSettings(storage(JSON.stringify({ motion }))).motion)
        .toBe(motion);
    }
  });

  it("keeps the default for an unknown value, and ignores unknown settings", () => {
    expect(readSettings(storage('{"motion":"slow","later":true}')))
      .toEqual(DEFAULT_SETTINGS);
  });

  it("falls back to the defaults for anything but an object", () => {
    for (const value of ["not json", "[]", '"reduce"', "42"]) {
      expect(readSettings(storage(value))).toEqual(DEFAULT_SETTINGS);
    }
  });

  it("falls back to the defaults when storage throws", () => {
    const blocked = {
      getItem: (): string | null => {
        throw new DOMException("denied", "SecurityError");
      },
    };
    expect(readSettings(blocked)).toEqual(DEFAULT_SETTINGS);
  });

  it("reads back what saveSettings wrote", () => {
    const stored = new Map<string, string>();
    saveSettings({
      getItem: (key) => stored.get(key) ?? null,
      setItem: (key, value) => void stored.set(key, value),
      removeItem: (key) => void stored.delete(key),
    }, { motion: "reduce" });
    expect(readSettings(storage(stored.get(SETTINGS_KEY) ?? null)).motion)
      .toBe("reduce");
  });
});

describe("reducesMotion", () => {
  it("follows the system by default", () => {
    expect(reducesMotion("system", true)).toBe(true);
    expect(reducesMotion("system", false)).toBe(false);
  });

  it("overrides the system either way", () => {
    expect(reducesMotion("reduce", false)).toBe(true);
    expect(reducesMotion("full", true)).toBe(false);
  });
});
