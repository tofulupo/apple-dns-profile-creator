import { afterEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  asError,
  canShareProfile,
  profileFile,
  shareProfile,
  shareProfileInApp,
} from "../../src/ui/download.ts";
import type { TauriGlobal } from "../../src/ui/desktop.ts";

const FILENAME = "encrypted-dns.mobileconfig";

function fakeNavigator(parts: Partial<Navigator>): Navigator {
  return parts as Navigator;
}

describe("profileFile", () => {
  it("is the profile under its name, typed as a configuration profile", async () => {
    const file = profileFile(FILENAME, "<plist/>");
    expect(file.name).toBe(FILENAME);
    expect(file.type).toBe("application/x-apple-aspen-config");
    expect(await file.text()).toBe("<plist/>");
  });
});

describe("canShareProfile", () => {
  it("is false without Web Share, as on a plain http:// address", () => {
    expect(canShareProfile(FILENAME, fakeNavigator({}))).toBe(false);
  });

  it("asks the browser about the profile file itself", () => {
    let asked: ShareData | undefined;
    const nav = fakeNavigator({
      share: () => Promise.resolve(),
      canShare: (data) => {
        asked = data;
        return true;
      },
    });
    expect(canShareProfile(FILENAME, nav)).toBe(true);
    expect(asked?.files?.[0]?.name).toBe(FILENAME);
    expect(asked?.files?.[0]?.type).toBe("application/x-apple-aspen-config");
  });

  it("is false when the browser does not share that file type", () => {
    const nav = fakeNavigator({
      share: () => Promise.resolve(),
      canShare: () => false,
    });
    expect(canShareProfile(FILENAME, nav)).toBe(false);
  });

  it("is false when the check itself throws", () => {
    const nav = fakeNavigator({
      share: () => Promise.resolve(),
      canShare: () => {
        throw new TypeError("nope");
      },
    });
    expect(canShareProfile(FILENAME, nav)).toBe(false);
  });
});

describe("shareProfile", () => {
  it("shares the file alone, with no text that could replace it", async () => {
    let shared: ShareData | undefined;
    const nav = fakeNavigator({
      share: (data) => {
        shared = data;
        return Promise.resolve();
      },
    });
    expect(await shareProfile(FILENAME, "<plist/>", nav)).toBe(true);
    expect(Object.keys(shared ?? {})).toEqual(["files"]);
    expect(await shared?.files?.[0]?.text()).toBe("<plist/>");
  });

  it("resolves false when the share sheet is closed", async () => {
    const nav = fakeNavigator({
      share: () => Promise.reject(new DOMException("closed", "AbortError")),
    });
    expect(await shareProfile(FILENAME, "<plist/>", nav)).toBe(false);
  });

  it("rejects with any other failure", async () => {
    const nav = fakeNavigator({
      share: () =>
        Promise.reject(new DOMException("no gesture", "NotAllowedError")),
    });
    await expect(shareProfile(FILENAME, "<plist/>", nav)).rejects.toThrow(
      "no gesture",
    );
  });
});

describe("in the desktop app", () => {
  const global = globalThis as { __TAURI__?: TauriGlobal };
  afterEach(() => {
    delete global.__TAURI__;
  });

  function fakeApp(fail = false) {
    const calls: [string, Record<string, unknown> | undefined][] = [];
    global.__TAURI__ = {
      core: {
        invoke: (command, args) => {
          calls.push([command, args]);
          return fail ? Promise.reject("Keychain said no") : Promise.resolve();
        },
      },
      event: { listen: () => Promise.resolve() },
    };
    return calls;
  }

  it("can always share, through the macOS share menu", () => {
    fakeApp();
    expect(canShareProfile(FILENAME, fakeNavigator({}))).toBe(true);
  });

  it("shares signed or not, below the button", async () => {
    const calls = fakeApp();
    const anchor = { x: 10, y: 600, width: 200, height: 36 };
    await shareProfileInApp(FILENAME, "<plist/>", "ABC", anchor);
    await shareProfileInApp(FILENAME, "<plist/>", undefined, anchor);
    expect(calls).toEqual([
      ["share_profile", {
        filename: FILENAME,
        xml: "<plist/>",
        signWith: "ABC",
        anchor,
      }],
      ["share_profile", {
        filename: FILENAME,
        xml: "<plist/>",
        signWith: null,
        anchor,
      }],
    ]);
  });

  it("rejects with the app's message as an Error", async () => {
    fakeApp(true);
    await expect(
      shareProfileInApp(FILENAME, "<plist/>", undefined, {
        x: 0,
        y: 0,
        width: 1,
        height: 1,
      }),
    ).rejects.toThrow("Keychain said no");
  });
});

describe("asError", () => {
  it("passes an Error through unchanged", () => {
    const error = new TypeError("boom");
    expect(asError(error)).toBe(error);
  });

  it("keeps the message of a failed desktop command", () => {
    const error = asError("Permission denied (os error 13)");
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe("Permission denied (os error 13)");
  });
});
