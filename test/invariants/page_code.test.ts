import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { cspDirectives, read, tauriConfig } from "../helpers/scan.ts";

const OWN_SOURCES = [
  "'self'",
  "'none'",
  "data:",
  "ipc:",
  "http://ipc.localhost",
];

describe("the page can't run code it didn't ship with", () => {
  it("allows no inline or evaluated code and no other origin", () => {
    const outside = [...cspDirectives()].flatMap(([name, sources]) =>
      sources.filter((source) => !OWN_SOURCES.includes(source))
        .map((source) => `${name} ${source}`)
    );
    expect(outside).toEqual([]);
    expect(cspDirectives().get("script-src")).toEqual(["'self'"]);
    expect(cspDirectives().get("object-src")).toEqual(["'none'"]);
  });

  it("keeps the prototypes frozen", () => {
    expect(tauriConfig().app.security.freezePrototype).toBe(true);
  });

  it("lets Tauri add the hashes of the app's own scripts to the policy", () => {
    expect(read("src-tauri/tauri.conf.json")).not.toContain(
      "dangerousDisableAssetCspModification",
    );
  });
});
