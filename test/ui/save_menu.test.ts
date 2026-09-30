/**
 * Tests for File > Save (⌘S) in the desktop app.
 */
import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import type { TauriGlobal } from "../../src/ui/desktop.ts";
import { ask } from "../../src/ui/dialogs.ts";
import {
  enableSaveMenu,
  menuTitle,
  type SaveMenuBindings,
} from "../../src/ui/save_menu.ts";

describe("menuTitle", () => {
  it("title-cases the buttons' labels as Mac menus do", () => {
    expect(menuTitle("Add to profile")).toBe("Add to Profile");
    expect(menuTitle("Save changes")).toBe("Save Changes");
    expect(menuTitle("Download signed profile")).toBe(
      "Download Signed Profile",
    );
  });

  it("keeps a minor word capitalized only at the start", () => {
    expect(menuTitle("to the list")).toBe("To the List");
    expect(menuTitle("  Add   To  profile ")).toBe("Add to Profile");
  });
});

function fakeMenu() {
  const shown: [string, boolean][] = [];
  let save: () => void = () => {};
  const bindings: SaveMenuBindings = {
    setSaveAction: (label, enabled) => {
      shown.push([label, enabled]);
      return Promise.resolve();
    },
    onSaveRequested: (listener) => {
      save = listener;
      return Promise.resolve();
    },
  };
  return { shown, bindings, choose: () => save() };
}

describe("enableSaveMenu", () => {
  const global = globalThis as { __TAURI__?: TauriGlobal };
  afterEach(() => {
    delete global.__TAURI__;
  });

  it("does nothing in a browser", () => {
    const update = enableSaveMenu(() => {}, undefined);
    expect(() => update("Add to profile", true)).not.toThrow();
  });

  it("names the item after the button, telling the app only of changes", () => {
    const { shown, bindings } = fakeMenu();
    const update = enableSaveMenu(() => {}, bindings);
    update("Add to profile", true);
    update("Add to profile", true);
    update("Save changes", true);
    update("Save changes", false);
    expect(shown).toEqual([
      ["Add to Profile", true],
      ["Save Changes", true],
      ["Save Changes", false],
    ]);
  });

  it("saves when chosen, but not behind an open dialog", async () => {
    const { bindings, choose } = fakeMenu();
    let saves = 0;
    enableSaveMenu(() => saves++, bindings);
    choose();
    expect(saves).toBe(1);

    let answer: (ok: boolean) => void = () => {};
    global.__TAURI__ = {
      core: { invoke: () => new Promise((resolve) => answer = resolve) },
      event: { listen: () => Promise.resolve() },
    };
    const asked = ask("Replace the server?");
    choose();
    expect(saves).toBe(1);
    answer(false);
    await asked;
    choose();
    expect(saves).toBe(2);
  });
});
