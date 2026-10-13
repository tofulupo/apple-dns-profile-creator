import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join, resolve } from "@std/path";

import { allowed, COMMANDS, EVENTS } from "../../isolation/hook.js";
import {
  APPEARANCE_EVENT,
  CARD_MENU_EVENT,
  MOTION_EVENT,
  OPENED_EVENT,
  SAVE_EVENT,
  SHARE_EVENT,
  tauriBindings,
} from "../../src/ui/desktop.ts";
import { MAX_PROFILE_BYTES } from "../../src/ui/dropzone.ts";

const here = import.meta.dirname;
if (here === undefined) throw new Error("Must be loaded from a file URL");
const ROOT = resolve(here, "..", "..");
const read = (path: string) => Deno.readTextFileSync(join(ROOT, path));

interface Call {
  cmd: string;
  callback: number;
  error: number;
  payload: unknown;
  options?: unknown;
}

const call = (cmd: string, payload: unknown = {}): Call => ({
  cmd,
  callback: 1,
  error: 2,
  payload,
});

/** Every call the pages make, through the real bindings, as Tauri sends them. */
async function callsThePagesMake(): Promise<Call[]> {
  const calls: Call[] = [];
  const bindings = tauriBindings({
    core: {
      invoke: (cmd, args) => {
        calls.push(call(cmd, args ?? {}));
        return Promise.resolve(undefined);
      },
    },
    event: {
      // As @tauri-apps/api's listen() calls the event plugin.
      listen: (event) => {
        calls.push(
          call("plugin:event|listen", {
            event,
            target: { kind: "Any" },
            handler: 7,
          }),
        );
        return Promise.resolve(() => {});
      },
    },
  });
  const xml = "<plist/>";
  const anchor = { x: 10, y: 20.5, width: 30, height: 40 };
  await Promise.all([
    bindings.pageReady?.([255, 255, 255]),
    bindings.pageReady?.(undefined),
    bindings.saveProfile?.("Quad9.mobileconfig", xml, undefined),
    bindings.saveProfile?.("Quad9.mobileconfig", xml, "A99155E1588E5A52"),
    bindings.shareProfile?.("Quad9.mobileconfig", xml, undefined, anchor),
    bindings.setShareEnabled?.(true),
    bindings.listSigningIdentities?.(),
    bindings.ask?.("Delete all configurations on this page?"),
    bindings.tell?.("Could not save the profile."),
    bindings.takeOpenedProfile?.(),
    bindings.openDroppedProfile?.(
      "signed.mobileconfig",
      new Uint8Array([48, 0, 255]),
    ),
    bindings.setSaveAction?.("Save Profile…", false),
    bindings.setAppearance?.("dark"),
    bindings.setMotion?.("reduce"),
    bindings.forgetOnQuit?.(),
    bindings.setForgetOnQuit?.(false),
    bindings.showCardMenu?.(true),
    bindings.onShareRequested?.(() => {}),
    bindings.onProfilesOpened?.(() => {}),
    bindings.onSaveRequested?.(() => {}),
    bindings.onAppearanceChosen?.(() => {}),
    bindings.onMotionChosen?.(() => {}),
    bindings.onCardMenuChosen?.(() => {}),
  ]);
  // The title bar (data-tauri-drag-region), from Tauri's drag script.
  calls.push(call("plugin:window|start_dragging"));
  calls.push(call("plugin:window|internal_toggle_maximize"));
  return calls;
}

describe("the isolation hook", () => {
  it("lets through every call the pages make", async () => {
    const calls = await callsThePagesMake();
    expect(calls.filter((c) => !allowed(c))).toEqual([]);
    expect(new Set(calls.map((c) => c.cmd))).toEqual(
      new Set(Object.keys(COMMANDS)),
    );
  });

  it("drops a command the app doesn't have", () => {
    for (const cmd of ["spike_dropped", "plugin:fs|read_file", "toString"]) {
      expect(allowed(call(cmd))).toBe(false);
    }
  });

  it("drops a call with another set of arguments", () => {
    expect(allowed(call("set_share_enabled", {}))).toBe(false);
    expect(allowed(call("set_share_enabled", { enabled: true, more: 1 })))
      .toBe(false);
    expect(allowed(call("take_opened_profile", { path: "/etc/passwd" })))
      .toBe(false);
    expect(
      allowed(call(
        "set_share_enabled",
        JSON.parse(
          '{"enabled": true, "__proto__": {}}',
        ),
      )),
    ).toBe(false);
  });

  it("drops arguments of the wrong type or value", () => {
    for (
      const [cmd, payload] of [
        ["set_share_enabled", { enabled: "true" }],
        ["set_appearance", { appearance: "neon" }],
        ["set_motion", { motion: null }],
        ["page_ready", { background: [255, 255] }],
        ["page_ready", { background: [256, 0, 0] }],
        ["save_profile", { filename: "a", xml: 1, signWith: null }],
        ["open_dropped_profile", { name: "a", bytes: [1, -1] }],
        ["open_dropped_profile", { name: "a", bytes: [0.5] }],
        ["open_dropped_profile", { name: "a", bytes: "AAEC" }],
        ["show_card_menu", { fix: 1 }],
        ["plugin:event|listen", {
          event: "tauri://drag-drop",
          target: { kind: "Any" },
          handler: 1,
        }],
        ["plugin:event|listen", {
          event: SAVE_EVENT,
          target: { kind: "AnyLabel", label: "main" },
          handler: 1,
        }],
        ["share_profile", {
          filename: "a",
          xml: "b",
          signWith: null,
          anchor: { x: 0, y: 0, width: Infinity, height: 0 },
        }],
      ] as const
    ) {
      expect({ cmd, allowed: allowed(call(cmd, payload)) }).toEqual({
        cmd,
        allowed: false,
      });
    }
  });

  it("drops a profile larger than Rust would read", () => {
    const xml = " ".repeat(MAX_PROFILE_BYTES);
    expect(
      allowed(call("save_profile", { filename: "a", xml, signWith: null })),
    )
      .toBe(true);
    expect(
      allowed(call("save_profile", {
        filename: "a",
        xml: xml + " ",
        signWith: null,
      })),
    ).toBe(false);
    expect(
      allowed(call("open_dropped_profile", {
        name: "a",
        bytes: new Array(MAX_PROFILE_BYTES + 1).fill(0),
      })),
    ).toBe(false);
  });

  it("drops anything that isn't a call with an object of arguments", () => {
    for (
      const value of [
        null,
        "set_share_enabled",
        call("forget_on_quit", null),
        call("forget_on_quit", []),
        call("forget_on_quit", new Uint8Array([1])),
      ]
    ) {
      expect(allowed(value)).toBe(false);
    }
  });
});

describe("the isolation pattern", () => {
  const config = JSON.parse(read("src-tauri/tauri.conf.json")) as {
    app: { security: { pattern?: { use: string; options?: { dir: string } } } };
  };

  it("stays on, with the hook in isolation/", () => {
    expect(config.app.security.pattern).toEqual({
      use: "isolation",
      options: { dir: "../isolation" },
    });
    expect(read("isolation/index.html")).toContain(
      '<script type="module" src="hook.js"></script>',
    );
    const cargo = read("src-tauri/Cargo.toml");
    expect(cargo).toMatch(/^tauri = \{[^}]*features = \[[^\]]*"isolation"/m);
    expect(cargo).toMatch(
      /^tauri-build = \{[^}]*features = \[[^\]]*"isolation"/m,
    );
  });

  it("names exactly the registered commands and the plugin calls the pages may make", () => {
    const registered = (
      /generate_handler!\[([^\]]*)\]/.exec(read("src-tauri/src/lib.rs"))?.[1] ??
        ""
    ).split(",").map((path) => path.trim().split("::").pop()).filter(Boolean);
    const plugins = [
      ...new Set(
        ["default", "settings"].flatMap((name) =>
          (JSON.parse(read(`src-tauri/capabilities/${name}.json`)) as {
            permissions: string[];
          }).permissions
        ),
      ),
    ].flatMap((permission) => {
      const [, plugin, command] = /^core:(\w+):allow-([\w-]+)$/.exec(
        permission,
      ) ?? [];
      return plugin === undefined
        ? []
        : [`plugin:${plugin}|${command!.replaceAll("-", "_")}`];
    });
    expect(Object.keys(COMMANDS).sort()).toEqual(
      [...registered, ...plugins].sort(),
    );
  });

  it("knows the same events as the pages", () => {
    expect([...EVENTS].sort()).toEqual(
      [
        OPENED_EVENT,
        SAVE_EVENT,
        SHARE_EVENT,
        APPEARANCE_EVENT,
        CARD_MENU_EVENT,
        MOTION_EVENT,
      ].sort(),
    );
  });
});
