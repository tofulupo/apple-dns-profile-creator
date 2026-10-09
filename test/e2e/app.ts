import { afterAll, beforeAll, beforeEach } from "@std/testing/bdd";
import { emptyDir } from "@std/fs";
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

export function useApp(): () => App {
  let driver: Deno.ChildProcess | undefined;
  let browser: App | undefined;

  function app(): App {
    if (browser === undefined) throw new Error("No WebDriver session");
    return browser;
  }

  beforeAll(async () => {
    await emptyDir(HOME);
    await Deno.mkdir(`${HOME}/config`, { recursive: true });
    await Deno.writeTextFile(
      `${HOME}/config/user-dirs.dirs`,
      `XDG_DOWNLOAD_DIR="${DOWNLOADS}"\n`,
    );
    driver = await startDriver();
    browser = await remote({
      hostname: "127.0.0.1",
      port: PORT,
      logLevel: "warn",
      capabilities: { "tauri:options": { application: APP } },
    });
  });

  afterAll(async () => {
    await browser?.deleteSession();
    driver?.kill();
    await driver?.status;
  });

  beforeEach(async () => {
    await emptyDir(DOWNLOADS);
    await app().execute(() => localStorage.clear());
    await app().url("tauri://localhost/");
  });

  return app;
}

export async function addPreset(
  app: App,
  preset: string,
  adjust: () => Promise<void> = async () => {},
): Promise<void> {
  await app.$("#presetToggle").click();
  await app.$("#presetMenu").$(`button*=${preset}`).click();
  await adjust();
  await app.$("#btn_addToProfile").click();
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
