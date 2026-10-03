import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  APPEARANCE_EVENT,
  CARD_MENU_EVENT,
  type Invoke,
  OPENED_EVENT,
  SAVE_EVENT,
  SHARE_EVENT,
  tauriBindings,
  type TauriGlobal,
} from "../../src/ui/desktop.ts";
import { ask, dialogOpen, tell } from "../../src/ui/dialogs.ts";
import { parseRgb } from "../../src/ui/page_ready.ts";

function tauriWith(invoke: Invoke): TauriGlobal {
  return {
    core: { invoke },
    event: { listen: () => Promise.resolve(() => {}) },
  };
}

function recordingInvoke(result: unknown = undefined) {
  const calls: [string, Record<string, unknown> | undefined][] = [];
  return {
    calls,
    invoke: (command: string, args?: Record<string, unknown>) => {
      calls.push([command, args]);
      return Promise.resolve(result);
    },
  };
}

describe("tauriBindings", () => {
  it("passes arguments by the names the Rust commands take", async () => {
    const { calls, invoke } = recordingInvoke(true);
    const bindings = tauriBindings(tauriWith(invoke));
    await bindings.pageReady?.([14, 16, 19]);
    await bindings.pageReady?.();
    expect(await bindings.ask?.("Sure?")).toBe(true);
    await bindings.tell?.("Done.");
    await bindings.saveProfile?.("a.mobileconfig", "<x/>");
    await bindings.saveProfile?.("a.mobileconfig", "<x/>", "ABC");
    await bindings.listSigningIdentities?.();
    await bindings.takeOpenedProfile?.();
    await bindings.setSaveAction?.("Add to Profile", true);
    await bindings.shareProfile?.("a.mobileconfig", "<x/>", undefined, {
      x: 1,
      y: 2,
      width: 3,
      height: 4,
    });
    await bindings.setShareEnabled?.(true);
    await bindings.setAppearance?.("dark");
    await bindings.showCardMenu?.(true);
    expect(calls).toEqual([
      ["page_ready", { background: [14, 16, 19] }],
      ["page_ready", { background: null }],
      ["ask", { message: "Sure?" }],
      ["tell", { message: "Done." }],
      ["save_profile", {
        filename: "a.mobileconfig",
        xml: "<x/>",
        signWith: null,
      }],
      ["save_profile", {
        filename: "a.mobileconfig",
        xml: "<x/>",
        signWith: "ABC",
      }],
      ["list_signing_identities", undefined],
      ["take_opened_profile", undefined],
      ["set_save_action", { label: "Add to Profile", enabled: true }],
      ["share_profile", {
        filename: "a.mobileconfig",
        xml: "<x/>",
        signWith: null,
        anchor: { x: 1, y: 2, width: 3, height: 4 },
      }],
      ["set_share_enabled", { enabled: true }],
      ["set_appearance", { appearance: "dark" }],
      ["show_card_menu", { fix: true }],
    ]);
  });

  it("hears the menu's events, passing on only what it knows", async () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const bindings = tauriBindings({
      core: { invoke: () => Promise.resolve() },
      event: {
        listen: (event, handler) => {
          handlers.set(event, handler);
          return Promise.resolve(() => {});
        },
      },
    });
    const heard: unknown[] = [];
    await bindings.onSaveRequested?.(() => heard.push("save"));
    await bindings.onShareRequested?.(() => heard.push("share"));
    await bindings.onAppearanceChosen?.((appearance) => heard.push(appearance));
    await bindings.onCardMenuChosen?.((action) => heard.push(action));

    handlers.get(SAVE_EVENT)?.({ payload: null });
    handlers.get(SHARE_EVENT)?.({ payload: null });
    handlers.get(APPEARANCE_EVENT)?.({ payload: "light" });
    handlers.get(APPEARANCE_EVENT)?.({ payload: "sepia" });
    handlers.get(CARD_MENU_EVENT)?.({ payload: "delete" });
    handlers.get(CARD_MENU_EVENT)?.({ payload: "rename" });
    handlers.get(CARD_MENU_EVENT)?.(null);
    expect(heard).toEqual(["save", "share", "light", "delete"]);

    const rust = await Deno.readTextFile(
      new URL("../../src-tauri/src/menu.rs", import.meta.url),
    );
    for (
      const [name, value] of Object.entries({
        SAVE_EVENT,
        SHARE_EVENT,
        APPEARANCE_EVENT,
        CARD_MENU_EVENT,
      })
    ) {
      expect(rust).toContain(
        `pub const ${name}: &str = ${JSON.stringify(value)};`,
      );
    }
  });

  it("listens for opened profiles under the event the app emits", async () => {
    const handlers = new Map<string, (event: unknown) => void>();
    const bindings = tauriBindings({
      core: { invoke: () => Promise.resolve() },
      event: {
        listen: (event, handler) => {
          handlers.set(event, handler);
          return Promise.resolve(() => {});
        },
      },
    });
    let heard = 0;
    await bindings.onProfilesOpened?.(() => heard++);
    handlers.get(OPENED_EVENT)?.({ payload: null });
    expect(heard).toBe(1);

    const rust = await Deno.readTextFile(
      new URL("../../src-tauri/src/opened.rs", import.meta.url),
    );
    expect(rust).toContain(
      `pub const OPENED_EVENT: &str = ${JSON.stringify(OPENED_EVENT)};`,
    );
  });
});

describe("ask and tell", () => {
  const global = globalThis as { __TAURI__?: unknown };
  const fakeTauri = (invoke: Invoke) => {
    global.__TAURI__ = tauriWith(invoke);
  };
  afterEach(() => {
    delete global.__TAURI__;
  });

  it("use the desktop app's dialogs when it has them", async () => {
    const { calls, invoke } = recordingInvoke(true);
    fakeTauri(invoke);
    expect(await ask("Delete?")).toBe(true);
    await tell("Saved.");
    expect(calls).toEqual([
      ["ask", { message: "Delete?" }],
      ["tell", { message: "Saved." }],
    ]);
  });

  it("count as open until answered", async () => {
    let answer: (ok: boolean) => void = () => {};
    fakeTauri(() => new Promise((resolve) => answer = resolve));
    const asked = ask("Delete?");
    expect(dialogOpen()).toBe(true);
    answer(true);
    expect(await asked).toBe(true);
    expect(dialogOpen()).toBe(false);
  });

  it("answer no when the dialog fails", async () => {
    fakeTauri(() => Promise.reject("no window"));
    const error = console.error;
    console.error = () => {};
    try {
      expect(await ask("Delete?")).toBe(false);
    } finally {
      console.error = error;
    }
  });
});

describe("parseRgb", () => {
  it("reads computed rgb() and rgba() colours", () => {
    expect(parseRgb("rgb(14, 16, 19)")).toEqual([14, 16, 19]);
    expect(parseRgb("rgba(248, 250, 252, 0.5)")).toEqual([248, 250, 252]);
    expect(parseRgb("rgb(1 2 3)")).toEqual([1, 2, 3]);
  });

  it("rejects anything else", () => {
    expect(parseRgb("transparent")).toBeUndefined();
    expect(parseRgb("color(srgb 1 0 0)")).toBeUndefined();
    expect(parseRgb("rgb(300, 0, 0)")).toBeUndefined();
  });
});
