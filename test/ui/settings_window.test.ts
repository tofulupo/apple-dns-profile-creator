import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  FORGET_NEXT_START,
  forgetNote,
  KEEP_NEXT_START,
} from "../../src/ui/settings_window.ts";
import { SEEDED_KEY, SETTINGS_KEY, THEME_KEY } from "../../src/ui/storage.ts";

describe("Forget everything when quitting", () => {
  it("says nothing while the saved choice is what this session does", () => {
    expect(forgetNote({ stored: false, active: false })).toBeUndefined();
    expect(forgetNote({ stored: true, active: true })).toBeUndefined();
  });

  it("says when a change starts, and what happens until then", () => {
    expect(forgetNote({ stored: true, active: false })).toBe(FORGET_NEXT_START);
    expect(forgetNote({ stored: false, active: true })).toBe(KEEP_NEXT_START);
  });
});

describe("the app's saved theme and motion", () => {
  it("are put into each window under the keys the pages read", async () => {
    const rust = await Deno.readTextFile(
      new URL("../../src-tauri/src/app_settings.rs", import.meta.url),
    );
    for (const key of [THEME_KEY, SETTINGS_KEY]) {
      expect(rust).toContain(`localStorage.setItem(${JSON.stringify(key)}`);
    }
    expect(rust).toContain(
      `localStorage.removeItem(${JSON.stringify(THEME_KEY)})`,
    );
    expect(rust).toContain(
      `sessionStorage.getItem(${JSON.stringify(SEEDED_KEY)})`,
    );
    expect(rust).toContain(
      `sessionStorage.setItem(${JSON.stringify(SEEDED_KEY)}`,
    );
  });
});
