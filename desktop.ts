// Desktop entrypoint (macOS): serves dist/ to the embedded webview and saves
// profiles through a binding, since the webview has no download manager.
//
// Runs only inside `deno desktop`, via `deno task desktop`. Under `deno run`
// there is no `Deno.BrowserWindow`, and `deno desktop` is also what binds
// `Deno.serve` to a private 127.0.0.1 port and turns `prompt`, `confirm` and
// `alert` into native dialogs.
/// <reference path="./desktop.d.ts" />
import { serveDir } from "@std/http/file-server";
import { basename, fromFileUrl, join } from "@std/path";
import manifest from "./deno.json" with { type: "json" };
import type { DesktopBindings } from "./src/desktop/bindings.ts";
import { saveWithoutOverwrite } from "./src/desktop/save.ts";
import { loadWindowSize, saveWindowSize } from "./src/desktop/window_state.ts";

if (typeof Deno.BrowserWindow !== "function") {
  console.error("desktop.ts runs only inside deno desktop: deno task desktop");
  Deno.exit(1);
}

const APP = manifest.desktop.app;

// Not Deno.cwd(): a compiled binary runs in the user's working directory, while
// dist/ is embedded next to this module.
const DIST = fromFileUrl(new URL("./dist", import.meta.url));

function homeDirectory(): string {
  const home = Deno.env.get("HOME");
  if (home === undefined || home === "") {
    throw new Error("Could not find your home folder.");
  }
  return home;
}

// Where macOS expects per-app settings, keyed by the bundle identifier.
const WINDOW_STATE = join(
  homeDirectory(),
  "Library",
  "Application Support",
  APP.identifier,
  "window.json",
);

Deno.serve((request) => serveDir(request, { fsRoot: DIST, quiet: true }));

const main = new Deno.BrowserWindow({
  title: APP.name,
  ...await loadWindowSize(WINDOW_STATE),
});

// Resizing fires continuously, so the size is written once it settles, and
// on close in case the window is shut before that.
let pendingSave: number | undefined;

function rememberSize(): void {
  clearTimeout(pendingSave);
  pendingSave = undefined;
  const [width, height] = main.getSize();
  saveWindowSize(WINDOW_STATE, { width, height }).catch((error) =>
    console.error("Could not remember the window size:", error)
  );
}

main.addEventListener("resize", () => {
  clearTimeout(pendingSave);
  pendingSave = setTimeout(rememberSize, 500);
});
main.addEventListener("close", () => {
  if (pendingSave !== undefined) rememberSize();
});

async function openFile(path: string): Promise<boolean> {
  try {
    const { success } = await new Deno.Command("open", {
      args: [path],
      stdout: "null",
      stderr: "null",
    }).output();
    return success;
  } catch {
    return false;
  }
}

// Typed against the shared declaration, but checked at runtime too: the
// arguments come from the webview.
const saveProfile: DesktopBindings["saveProfile"] = async (
  filename: unknown,
  xml: unknown,
) => {
  if (typeof filename !== "string" || typeof xml !== "string") {
    throw new TypeError("saveProfile needs a file name and the profile text.");
  }

  const path = await saveWithoutOverwrite(
    join(homeDirectory(), "Downloads"),
    filename,
    xml,
  );
  const name = basename(path);

  // Opening a .mobileconfig hands it to System Settings, which is where the
  // profile has to be installed anyway.
  const open = confirm(
    `Saved “${name}” to your Downloads folder.\n\n` +
      "Open it now? macOS then asks you to review and install it in " +
      "System Settings.",
  );
  if (open && !await openFile(path)) {
    alert(
      `Could not open “${name}”. Double-click it in your Downloads folder ` +
        "to install it.",
    );
  }
};

main.bind("saveProfile", saveProfile);
