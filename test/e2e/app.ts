import { afterAll, beforeAll, beforeEach } from "@std/testing/bdd";
import { emptyDir, walkSync } from "@std/fs";
import { join } from "@std/path";
import { fromFileUrl } from "@std/path";
import { remote } from "webdriverio";

declare global {
  namespace WebdriverIO {
    interface Capabilities {
      "tauri:options"?: { application: string };
    }
  }
}

export type App = Awaited<ReturnType<typeof remote>>;

const APP = fromFileUrl(
  new URL("../../src-tauri/target/debug/dns-profile-creator", import.meta.url),
);
const HOME = fromFileUrl(
  new URL("../../src-tauri/target/e2e-home", import.meta.url),
);
const DOWNLOADS = join(HOME, "downloads");
const PORT = 4598;

function ensureFree(port: number): void {
  try {
    Deno.listen({ hostname: "127.0.0.1", port }).close();
  } catch (error) {
    if (!(error instanceof Deno.errors.AddrInUse)) throw error;
    throw new Error(
      `Port ${port} is in use, maybe by WebKitWebDriver or the app left over ` +
        "from a run that didn't finish",
    );
  }
}

const pause = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function appRunning(): Promise<boolean> {
  const { code } = await new Deno.Command("pgrep", {
    args: ["-f", APP],
    stdout: "null",
  }).output();
  return code === 0;
}

// The app outlives its session for a moment, and its WebKit helpers write the
// cache until they notice it is gone. Starting the next file's app before
// then fails to empty the home folder (ENOTEMPTY).
async function waitForAppExit(): Promise<void> {
  for (let attempt = 0; attempt < 50 && await appRunning(); attempt++) {
    await pause(100);
  }
}

async function emptyHome(): Promise<void> {
  for (let attempt = 0;; attempt++) {
    try {
      return await emptyDir(HOME);
    } catch (error) {
      if (attempt >= 20 || (error as { code?: string }).code !== "ENOTEMPTY") {
        throw error;
      }
      await pause(100);
    }
  }
}

async function startDriver(): Promise<Deno.ChildProcess> {
  ensureFree(PORT);
  ensureFree(PORT - 1);
  const driver = new Deno.Command("tauri-driver", {
    args: ["--port", String(PORT), "--native-port", String(PORT - 1)],
    env: {
      XDG_CONFIG_HOME: `${HOME}/config`,
      XDG_DATA_HOME: `${HOME}/data`,
      XDG_CACHE_HOME: `${HOME}/cache`,
    },
    stdout: "null",
  }).spawn();
  for (let attempt = 0; attempt < 50; attempt++) {
    try {
      const response = await fetch(`http://127.0.0.1:${PORT}/status`);
      await response.body?.cancel();
      return driver;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }
  driver.kill();
  await driver.status;
  throw new Error("tauri-driver did not start");
}

function session(): Promise<App> {
  return remote({
    hostname: "127.0.0.1",
    port: PORT,
    logLevel: "warn",
    capabilities: { "tauri:options": { application: APP } },
  });
}

export type UseApp = (() => App) & {
  /** Ends the app the way a force quit does, and starts it again. */
  restart(): Promise<void>;
  /**
   * Starts the app once with web views that keep nothing, which WebKitGTK
   * doesn't let WebDriver drive, and ends it again.
   */
  launchUndriven(): Promise<void>;
};

export function useApp(): UseApp {
  let driver: Deno.ChildProcess | undefined;
  let browser: App | undefined;

  function app(): App {
    if (browser === undefined) throw new Error("No WebDriver session");
    return browser;
  }

  async function restart(): Promise<void> {
    await browser?.deleteSession();
    browser = await session();
  }

  async function launchUndriven(): Promise<void> {
    await browser?.deleteSession();
    browser = undefined;
    const refused = await session().then(
      (started) => started.deleteSession().then(() => false),
      () => true,
    );
    if (!refused) {
      throw new Error("WebDriver drove a web view that keeps nothing");
    }
  }

  beforeAll(async () => {
    await waitForAppExit();
    await emptyHome();
    await Deno.mkdir(`${HOME}/config`, { recursive: true });
    await Deno.writeTextFile(
      `${HOME}/config/user-dirs.dirs`,
      `XDG_DOWNLOAD_DIR="${DOWNLOADS}"\n`,
    );
    // Forgetting is the default, and WebKitGTK lets WebDriver drive only a
    // web view that keeps its data.
    await saveAppSettings({ forgetOnQuit: false });
    driver = await startDriver();
    browser = await session();
  });

  afterAll(async () => {
    await browser?.deleteSession().catch(() => {});
    driver?.kill();
    await driver?.status;
    await waitForAppExit();
  });

  beforeEach(async () => {
    await emptyDir(DOWNLOADS);
    await app().execute(() => localStorage.clear());
    await app().url("tauri://localhost/");
  });

  return Object.assign(app, { restart, launchUndriven });
}

const APP_ID = "local.encrypted-dns.tool";

/** Saves the app's settings file, as the Settings window would. */
export async function saveAppSettings(settings: object): Promise<void> {
  const folder = join(HOME, "config", APP_ID);
  await Deno.mkdir(folder, { recursive: true });
  await Deno.writeTextFile(
    join(folder, "settings.json"),
    JSON.stringify(settings),
  );
}

/** xdotool needs X11: CI's xvfb, or `Xwayland :99` without WAYLAND_DISPLAY. */
export const onX11 = Deno.env.get("WAYLAND_DISPLAY") === undefined &&
  Deno.env.get("DISPLAY") !== undefined;

export function readAppSettings(): Record<string, unknown> {
  return JSON.parse(
    Deno.readTextFileSync(join(HOME, "config", APP_ID, "settings.json")),
  );
}

async function pressKeysIn(name: string, keys: string): Promise<void> {
  const [window] = (await xdotool(
    "search",
    "--sync",
    "--onlyvisible",
    "--name",
    name,
  )).split("\n");
  // A desktop's window manager wants the window activated; CI's bare xvfb has
  // none and refuses, and focusing is enough there.
  await xdotool("windowactivate", "--sync", window!).catch(() => "");
  await xdotool("windowfocus", "--sync", window!);
  await xdotool("key", "--delay", "100", keys);
}

async function xdotool(...args: string[]): Promise<string> {
  const { success, stdout, stderr } = await new Deno.Command("xdotool", {
    args,
    stdout: "piped",
    stderr: "piped",
  }).output();
  if (!success) {
    throw new Error(
      `xdotool ${args.join(" ")}: ${new TextDecoder().decode(stderr).trim()}`,
    );
  }
  return new TextDecoder().decode(stdout).trim();
}

/**
 * Opens Settings the only way the app offers, its menu shortcut, as a real
 * key press (WebDriver can't reach native menus), runs `use` in it and comes
 * back to the main window. Settings stays open: on Linux only the main window
 * has the menu's shortcuts, and after WebDriver closes it the app no longer
 * opens a new one. A later call reloads it, so it reads the settings again.
 */
export async function inSettings(
  app: App,
  use: () => Promise<void>,
): Promise<void> {
  const main = await app.getWindowHandle();
  const rect = await app.getWindowRect();
  const other = async () =>
    (await app.getWindowHandles()).find((handle) => handle !== main);
  let settings = await other();
  if (settings === undefined) {
    await pressKeysIn("DNS Profile Creator", "ctrl+comma");
    for (let attempt = 0; attempt < 50 && settings === undefined; attempt++) {
      await pause(100);
      settings = await other();
    }
    if (settings === undefined) throw new Error("Ctrl+, opened no Settings");
    await app.switchToWindow(settings);
  } else {
    await app.switchToWindow(settings);
    await app.refresh();
  }
  await app.$("#forgetChk:not([disabled])").waitForExist();
  try {
    await use();
  } finally {
    await app.switchToWindow(main);
    // A tiling window manager shrinks the main window next to Settings.
    await app.setWindowRect(rect.x, rect.y, rect.width, rect.height);
  }
}

/**
 * Files under the web view's data and cache folders that hold `text`, in
 * UTF-8 or in the UTF-16 WebKit stores page storage in.
 */
export function filesHolding(text: string): string[] {
  const needles = [
    new TextEncoder().encode(text),
    new Uint8Array(
      [...text].flatMap((
        char,
      ) => [char.charCodeAt(0) & 0xff, char.charCodeAt(0) >> 8]),
    ),
  ];
  const holds = (bytes: Uint8Array, needle: Uint8Array) => {
    outer: for (let i = 0; i + needle.length <= bytes.length; i++) {
      for (let j = 0; j < needle.length; j++) {
        if (bytes[i + j] !== needle[j]) continue outer;
      }
      return true;
    }
    return false;
  };
  const found: string[] = [];
  for (
    const root of [join(HOME, "data", APP_ID), join(HOME, "cache", APP_ID)]
  ) {
    try {
      for (const entry of walkSync(root, { includeDirs: false })) {
        const bytes = Deno.readFileSync(entry.path);
        if (needles.some((needle) => holds(bytes, needle))) {
          found.push(entry.path.slice(HOME.length + 1));
        }
      }
    } catch (error) {
      if (!(error instanceof Deno.errors.NotFound)) throw error;
    }
  }
  return found;
}

export async function addPreset(
  app: App,
  preset: string,
  adjust: () => Promise<void> = async () => {},
): Promise<void> {
  await press(app.$("#presetToggle"));
  await press(app.$("#presetMenu").$(`button*=${preset}`));
  await adjust();
  await press(app.$("#btn_addToProfile"));
  await app.$("#configList").waitForDisplayed();
}

export async function press(
  element: ReturnType<App["$"]>,
): Promise<void> {
  await element.execute((target) => target.scrollIntoView({ block: "center" }));
  await element.click();
}

export async function openTab(app: App, name: string): Promise<void> {
  await app.$("nav.tabs").$(`a*=${name}`).click();
}

function downloaded(): Set<string> {
  return new Set([...Deno.readDirSync(DOWNLOADS)].map((entry) => entry.name));
}

// The app saves before it asks "Open it now?", and that native dialog stays
// open, so the page never hears back. The file is read from disk instead.
// When the next test leaves the page, Tauri sends the unanswered save again,
// so only a file that appears after this click counts.
export async function download(app: App): Promise<string> {
  const before = downloaded();
  await press(app.$("#downloadBtn"));
  for (let attempt = 0; attempt < 50; attempt++) {
    for (const name of downloaded()) {
      if (before.has(name)) continue;
      const text = Deno.readTextFileSync(join(DOWNLOADS, name));
      if (text.trimEnd().endsWith("</plist>")) return text;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("The app saved no profile");
}

export async function loadFile(
  app: App,
  name: string,
  text: string,
): Promise<void> {
  await app.execute(
    (name, text) => {
      const input = document.getElementById("fileupload") as HTMLInputElement;
      const transfer = new DataTransfer();
      transfer.items.add(new File([text], name));
      input.files = transfer.files;
      input.dispatchEvent(new Event("change", { bubbles: true }));
    },
    name,
    text,
  );
}

export function cardRows(
  app: App,
  card = 0,
): Promise<Record<string, string[]>> {
  return app.execute((card) => {
    const article = document.querySelectorAll("#dynamicList .profile-card")[
      card
    ];
    const rows: Record<string, string[]> = {};
    for (const term of article?.querySelectorAll("dt") ?? []) {
      const definition = term.nextElementSibling;
      const items = definition?.querySelectorAll(".badge, li") ?? [];
      rows[term.textContent ?? ""] = items.length > 0
        ? [...items].map((item) => item.textContent ?? "")
        : [definition?.textContent ?? ""];
    }
    return rows;
  }, card);
}

export function cardNames(app: App): Promise<string[]> {
  return app.$$("#dynamicList .profile-card__title").map((title) =>
    title.getText()
  );
}
