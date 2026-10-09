import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { emptyDir } from "@std/fs";
import { fromFileUrl } from "@std/path";
import { remote } from "webdriverio";

const APP = fromFileUrl(
  new URL("../../src-tauri/target/debug/dns-profile-creator", import.meta.url),
);

const HOME = fromFileUrl(
  new URL("../../src-tauri/target/e2e-home", import.meta.url),
);
const PORT = 4598;

declare global {
  namespace WebdriverIO {
    interface Capabilities {
      "tauri:options"?: { application: string };
    }
  }
}

async function startDriver(): Promise<Deno.ChildProcess> {
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

describe({
  name: "the app",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  let driver: Deno.ChildProcess | undefined;
  let browser: Awaited<ReturnType<typeof remote>> | undefined;

  function app(): Awaited<ReturnType<typeof remote>> {
    if (browser === undefined) throw new Error("No WebDriver session");
    return browser;
  }

  beforeAll(async () => {
    await emptyDir(HOME);
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

  it("Pick a preset and add it to the profile", async () => {
    await app().$("#presetToggle").click();
    await app().$("#presetMenu").$("button*=Quad9").click();
    await app().$("#btn_addToProfile").click();

    const list = app().$("#dynamicList");
    await list.$(".profile-card__title").waitForDisplayed();
    const names = await list.$$(".profile-card__title").map((title) =>
      title.getText()
    );
    expect(names).toEqual(["Quad9"]);
  });
});
