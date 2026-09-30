/**
 * Tests for the Tauri app's commands as the pages call them, and for the
 * native-dialog fallbacks.
 */
import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { tauriBindings } from "../../src/ui/desktop.ts";
import { ask, tell } from "../../src/ui/dialogs.ts";
import { parseRgb } from "../../src/ui/page_ready.ts";

type Invoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

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
    const bindings = tauriBindings(invoke);
    await bindings.pageReady?.([14, 16, 19]);
    await bindings.pageReady?.();
    expect(await bindings.ask?.("Sure?")).toBe(true);
    await bindings.tell?.("Done.");
    await bindings.saveProfile?.("a.mobileconfig", "<x/>");
    await bindings.saveProfile?.("a.mobileconfig", "<x/>", "ABC");
    await bindings.listSigningIdentities?.();
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
    ]);
  });
});

describe("ask and tell", () => {
  const global = globalThis as { __TAURI__?: unknown };
  const fakeTauri = (invoke: Invoke) => {
    global.__TAURI__ = { core: { invoke } };
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

  it("answer no when the dialog fails", async () => {
    // What a failed Tauri command rejects with: the Rust error as a string.
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
