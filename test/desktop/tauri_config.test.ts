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
      readonly visible?: boolean;
      readonly dragDropEnabled?: boolean;
    }[];
  };
  readonly bundle: {
    readonly icon: readonly string[];
    readonly copyright?: string;
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

  // The About panel and Info.plist show this line; macOS has no license field.
  it("names the app's license in its copyright line", () => {
    const license = Deno.readTextFileSync(join(SRC_TAURI, "LICENSE"));
    expect(license.startsWith("BSD 3-Clause License")).toBe(true);
    expect(config.bundle.copyright).toContain("BSD 3-Clause License");
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

function exists(path: string): boolean {
  try {
    Deno.statSync(path);
    return true;
  } catch {
    return false;
  }
}
