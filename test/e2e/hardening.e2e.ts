import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { type App, inSettings, onX11, useApp } from "./app.ts";

/** `freezePrototype` in tauri.conf.json freezes `Object.prototype` only. */
function frozenPrototype(app: App) {
  return app.execute(() => {
    try {
      Object.defineProperty(Object.prototype, "polluted", { value: true });
    } catch {
      // A frozen prototype refuses the new property.
    }
    return {
      frozen: Object.isFrozen(Object.prototype),
      polluted: "polluted" in {},
      url: location.protocol,
    };
  });
}

describe({
  name: "the app's pages",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  const app = useApp();

  // Not https: that one the app hands to the system browser, which would open
  // a browser on the machine running the tests.
  it("stay in the window when the page sends it somewhere else", async () => {
    const start = await app().getUrl();
    for (
      const target of [
        "file:///etc/hostname",
        "ftp://example.com/",
        "data:text/html,<p>elsewhere</p>",
      ]
    ) {
      await app().execute((url: string) => {
        location.href = url;
      }, target);
      await new Promise((done) => setTimeout(done, 500));
      expect({ target, url: await app().getUrl() })
        .toEqual({ target, url: start });
      expect(await app().$("#mainForm").isExisting()).toBe(true);
    }
  });

  it("can't add to Object.prototype in the main window", async () => {
    expect(await frozenPrototype(app())).toEqual({
      frozen: true,
      polluted: false,
      url: "tauri:",
    });
  });

  it({
    name: "can't add to Object.prototype in Settings",
    ignore: !onX11,
    fn: async () => {
      await inSettings(app(), async () => {
        expect(await frozenPrototype(app())).toEqual({
          frozen: true,
          polluted: false,
          url: "tauri:",
        });
      });
    },
  });
});
