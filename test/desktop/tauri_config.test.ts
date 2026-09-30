/**
 * Guards the desktop app's configuration: the settings that fixed bugs stay
 * set, and it stays in step with deno.json and the icon sources.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join, resolve } from "@std/path";

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

  // css/app.css takes the header's top padding off in the app, counting on
  // the title bar's space.
  it("shows the page's background in the title bar, without a title", () => {
    const [window] = config.app.windows;
    expect(window?.titleBarStyle).toBe("Transparent");
    expect(window?.hiddenTitle).toBe(true);
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

  it("are each granted to the page, with nothing else but events", () => {
    expect([...capability.permissions].sort()).toEqual(
      [
        "core:event:allow-listen",
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
