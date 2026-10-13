import { afterAll, beforeAll } from "@std/testing/bdd";
import { fromFileUrl } from "@std/path";
import { remote } from "webdriverio";

import { createHandler } from "../../scripts/server.ts";

export type Browser = Awaited<ReturnType<typeof remote>>;

const DIST = fromFileUrl(new URL("../../dist", import.meta.url));
// Not 4598 (the app's e2e tests) or 4599 (the playground).
const PORT = 4596;
export const SITE = `http://127.0.0.1:${PORT}/`;

/**
 * Chrome for Testing, which WebdriverIO downloads with its chromedriver, or
 * another Chromium with CHROME_BINARY and its version in CHROME_VERSION.
 */
function capabilities() {
  const binary = Deno.env.get("CHROME_BINARY");
  return {
    browserName: "chrome",
    browserVersion: Deno.env.get("CHROME_VERSION") ?? "stable",
    "goog:chromeOptions": {
      args: ["--headless=new", "--no-first-run", "--window-size=1100,900"],
      ...(binary === undefined ? {} : { binary }),
    },
  };
}

/** The built site from dist/, served as on Deno Deploy, in a fresh browser. */
export function useSite(): () => Browser {
  let server: Deno.HttpServer | undefined;
  let browser: Browser | undefined;

  beforeAll(async () => {
    server = Deno.serve(
      { hostname: "127.0.0.1", port: PORT, onListen: () => {} },
      createHandler(DIST),
    );
    browser = await remote({ logLevel: "warn", capabilities: capabilities() });
  });

  afterAll(async () => {
    await browser?.deleteSession().catch(() => {});
    await server?.shutdown();
  });

  return () => {
    if (browser === undefined) throw new Error("No WebDriver session");
    return browser;
  };
}

/** A new tab, as a person opens one: it starts with its own empty storage. */
export async function openNewTab(browser: Browser, path = ""): Promise<string> {
  const { handle } = await browser.createWindow("tab");
  await browser.switchToWindow(handle);
  await browser.url(new URL(path, SITE).href);
  return handle;
}

export async function closeOtherTabs(browser: Browser): Promise<void> {
  const [first, ...others] = await browser.getWindowHandles();
  for (const handle of others) {
    await browser.switchToWindow(handle);
    await browser.closeWindow();
  }
  await browser.switchToWindow(first!);
}

export function storedKeys(browser: Browser): Promise<{
  tab: string[];
  browser: string[];
}> {
  return browser.execute(() => {
    const keys = (area: Storage) =>
      Array.from({ length: area.length }, (_, i) => area.key(i)!)
        .filter((key) => key.startsWith("dns-mobileconfig:"))
        .sort();
    return { tab: keys(sessionStorage), browser: keys(localStorage) };
  });
}

export async function addPreset(browser: Browser, preset: string) {
  await browser.$("#presetToggle").click();
  await browser.$("#presetMenu").$(`button*=${preset}`).click();
  await browser.$("#btn_addToProfile").click();
  await browser.$("#configList").waitForDisplayed();
}

export function cardNames(browser: Browser): Promise<string[]> {
  return browser.$$("#dynamicList .profile-card__title").map((title) =>
    title.getText()
  );
}
