import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  capabilityPermissions,
  cspDirectives,
  read,
  tauriConfig,
} from "../helpers/scan.ts";

describe("links open only in the system browser", () => {
  const lib = read("src-tauri/src/lib.rs");

  it("gives the pages no way to open a link themselves", () => {
    expect(
      capabilityPermissions().filter((permission) =>
        /^(opener|shell):/.test(permission)
      ),
    ).toEqual([]);
    expect(lib).toContain(".open_js_links_on_click(false)");
  });

  it("builds every window in one place, which hands other origins to the browser", () => {
    expect(tauriConfig().app.windows.every((window) => window.create === false))
      .toBe(true);
    expect(lib.match(/WebviewWindowBuilder::/g)).toHaveLength(1);
    expect(lib).toContain(
      ".on_navigation(move |url| navigation::allow(&navigating, url))",
    );
    expect(lib).toMatch(/\.on_new_window\([^]*?NewWindowResponse::Deny/);
  });

  it("lets no form or base URL point the pages elsewhere", () => {
    const csp = cspDirectives();
    expect(csp.get("form-action")).toEqual(["'none'"]);
    expect(csp.get("base-uri")).toEqual(["'none'"]);
  });
});
