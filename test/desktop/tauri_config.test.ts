/**
 * Guards the desktop app's configuration: the settings that fixed bugs stay
 * set, and it stays in step with deno.json and the icon sources.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join, resolve } from "@std/path";

import { PAGES } from "../../pages/pages.ts";
import { pageHref } from "../../scripts/build.ts";

const here = import.meta.dirname;
if (here === undefined) throw new Error("Must be loaded from a file URL");
const SRC_TAURI = resolve(here, "..", "..", "src-tauri");

interface TauriConfig {
  readonly version: string;
  readonly identifier: string;
  readonly productName: string;
  readonly app: {
    readonly windows: readonly {
      readonly label?: string;
      readonly create?: boolean;
      readonly visible?: boolean;
      readonly dragDropEnabled?: boolean;
      readonly titleBarStyle?: string;
      readonly hiddenTitle?: boolean;
      readonly trafficLightPosition?: {
        readonly x: number;
        readonly y: number;
      };
    }[];
    readonly security: { readonly csp: string | null };
  };
  readonly bundle: {
    readonly icon: readonly string[];
    readonly copyright?: string;
    readonly fileAssociations?: readonly {
      readonly ext: readonly string[];
      readonly contentTypes?: readonly string[];
      readonly role?: string;
      readonly rank?: string;
    }[];
  };
}

const config = JSON.parse(
  Deno.readTextFileSync(join(SRC_TAURI, "tauri.conf.json")),
) as TauriConfig;

describe("src-tauri/tauri.conf.json", () => {
  it("takes the version from deno.json", () => {
    expect(config.version).toBe("../deno.json");
  });

  // The saved configurations (WebKit's storage) and the remembered window
  // size are filed under the identifier: changing it loses both.
  it("keeps its name and identifier", () => {
    expect(config.identifier).toBe("local.encrypted-dns.tool");
    expect(config.productName).toBe("DNS Profile Creator");
  });

  it("starts the window hidden, so no empty webview shows", () => {
    expect(config.app.windows.map((window) => window.visible)).toEqual([
      false,
    ]);
  });

  // Tauri's own drop handling swallows the drop, so the page's drop zones
  // would never see the file.
  it("leaves dropping files to the page", () => {
    expect(config.app.windows.map((window) => window.dragDropEnabled))
      .toEqual([false]);
  });

  // Created in src-tauri/src/lib.rs instead, which gives it the handlers
  // that open links outside the app; created here too, it would open twice.
  it("only describes the main window, which the app creates", () => {
    expect(config.app.windows.map(({ label, create }) => ({ label, create })))
      .toEqual([{ label: "main", create: false }]);
  });

  // css/app.css draws the title bar as part of the page, with its own items
  // and drag region (pages/_layout.html), around the window buttons.
  it("runs the page under the window buttons, without a title", () => {
    const [window] = config.app.windows;
    expect(window?.titleBarStyle).toBe("Overlay");
    expect(window?.hiddenTitle).toBe(true);
  });

  // AppKit centres the buttons 2px above trafficLightPosition's y.
  it("centres the window buttons in the page's title bar", () => {
    const css = Deno.readTextFileSync(
      resolve(SRC_TAURI, "..", "css", "app.css"),
    );
    const height = Number(/--titlebar:\s*(\d+)px/.exec(css)?.[1]);
    const y = config.app.windows[0]?.trafficLightPosition?.y ?? NaN;
    expect(height).toBeGreaterThan(0);
    expect(y - 2).toBe(height / 2);
  });

  // Merged into the app's Info.plist by Tauri.
  it("keeps the content clear of the camera housing by default", () => {
    const plist = Deno.readTextFileSync(join(SRC_TAURI, "Info.plist"));
    expect(plist).toMatch(
      /<key>NSPrefersDisplaySafeAreaCompatibilityMode<\/key>\s*<true\/>/,
    );
  });

  it("allows only the app's own scripts and styles", () => {
    const csp = config.app.security.csp ?? "";
    const directives = new Map(
      csp.split(";").map((directive) => {
        const [name = "", ...sources] = directive.trim().split(/\s+/);
        return [name, sources];
      }),
    );
    expect(directives.get("default-src")).toEqual(["'self'"]);
    // Tauri adds the hashes of the pages' inline scripts itself.
    expect(directives.get("script-src")).toEqual(["'self'"]);
    expect(directives.get("style-src")).toEqual(["'self'"]);
    expect(csp).not.toContain("unsafe");
  });

  // The About panel and Info.plist show this line; macOS has no license field.
  it("names the app's license in its copyright line", () => {
    const license = Deno.readTextFileSync(join(SRC_TAURI, "LICENSE"));
    expect(license.startsWith("BSD 3-Clause License")).toBe(true);
    expect(config.bundle.copyright).toContain("BSD 3-Clause License");
  });

  // Opening a profile normally installs it through System Settings, which
  // must stay the default; the app is only offered in Open With, as a
  // viewer, since it never writes to the file.
  it("opens profiles as an alternative to installing them", () => {
    expect(config.bundle.fileAssociations).toEqual([
      {
        ext: ["mobileconfig"],
        contentTypes: ["com.apple.mobileconfig"],
        name: "Configuration Profile",
        role: "Viewer",
        rank: "Alternate",
      },
    ]);
  });

  it("builds the icon from desktop/AppIcon.icon, with fallbacks that exist", () => {
    expect(config.bundle.icon).toContain("../desktop/AppIcon.icon");
    for (const icon of config.bundle.icon) {
      expect({ icon, exists: exists(join(SRC_TAURI, icon)) }).toEqual({
        icon,
        exists: true,
      });
    }
  });
});

// View > Tool (⌘1) and Profile (⌘2), src-tauri/src/menu.rs.
describe("the View menu's pages", () => {
  const menu = Deno.readTextFileSync(join(SRC_TAURI, "src", "menu.rs"));
  const listed = [
    ...(/const PAGES[^=]*=\s*\[([\s\S]*?)\];/.exec(menu)?.[1] ?? "")
      .matchAll(
        /label: "([^"]*)",\s*file: "([^"]*)",\s*href: "([^"]*)"/g,
      ),
  ].map(([, label, file, href]) => ({ label, file, href }));

  it("are the site's pages, with their tab labels, links and order", () => {
    expect(listed).toEqual(
      PAGES.map((page) => ({
        label: page.nav,
        file: page.file,
        href: pageHref(page),
      })),
    );
  });
});

describe("the app's commands", () => {
  const read = (path: string) => Deno.readTextFileSync(join(SRC_TAURI, path));
  const declared = [
    ...(/const COMMANDS[^=]*=\s*&\[([^\]]*)\]/.exec(read("build.rs"))?.[1] ??
      "").matchAll(/"(\w+)"/g),
  ].map(([, name]) => name);
  const registered = (
    /generate_handler!\[([^\]]*)\]/.exec(read("src/lib.rs"))?.[1] ?? ""
  ).split(",").map((path) => path.trim().split("::").pop()).filter(Boolean);
  const capability = JSON.parse(read("capabilities/default.json")) as {
    readonly permissions: readonly string[];
  };

  it("are all declared in build.rs, which makes them need a permission", () => {
    expect(declared.length).toBeGreaterThan(0);
    expect([...declared].sort()).toEqual([...registered].sort());
  });

  // Besides events, only what the title bar's drag region uses: dragging, and
  // zooming on a double click.
  it("are each granted to the page, with nothing else but events and the title bar", () => {
    expect([...capability.permissions].sort()).toEqual(
      [
        "core:event:allow-listen",
        "core:window:allow-start-dragging",
        "core:window:allow-internal-toggle-maximize",
        ...declared.map((name) => `allow-${name?.replaceAll("_", "-")}`),
      ].sort(),
    );
  });
});

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}
