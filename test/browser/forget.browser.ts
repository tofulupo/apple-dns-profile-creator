import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  addPreset,
  type Browser,
  cardNames,
  closeOtherTabs,
  openNewTab,
  SITE,
  storedKeys,
  useSite,
} from "./site.ts";

const CONFIGS = "dns-mobileconfig:configs:v1";
const KEEP = "dns-mobileconfig:keep";

async function profileCards(browser: Browser): Promise<string[]> {
  await browser.url(new URL("finalize.html", SITE).href);
  await browser.$("main").waitForExist();
  return cardNames(browser);
}

async function setForgetOnClose(browser: Browser, forget: boolean) {
  await browser.$("#keepPill").click();
  const toggle = browser.$("#keepChk");
  await toggle.waitForDisplayed();
  if (await toggle.isSelected() !== forget) await toggle.click();
  await browser.keys("Escape");
}

describe({
  name: "forgetting on close on the website",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  const site = useSite();

  beforeEach(async () => {
    await closeOtherTabs(site());
    await site().url(SITE);
    await site().execute(() => {
      localStorage.clear();
      sessionStorage.clear();
    });
    await site().refresh();
  });

  it("keeps a card in the tab only, so a new tab has none", async () => {
    await site().url(SITE);
    await addPreset(site(), "Quad9");

    expect(await storedKeys(site())).toMatchObject({ browser: [] });
    expect((await storedKeys(site())).tab).toContain(CONFIGS);
    expect(await site().$("#keepPill").getAttribute("data-on")).toBe("true");

    await openNewTab(site());
    expect(await profileCards(site())).toEqual([]);
  });

  it("moves the cards into the browser when told to keep them", async () => {
    await site().url(SITE);
    await addPreset(site(), "Quad9");

    await setForgetOnClose(site(), false);

    expect(await storedKeys(site())).toMatchObject({ tab: [] });
    expect((await storedKeys(site())).browser).toEqual(
      expect.arrayContaining([CONFIGS, KEEP]),
    );
    expect(await site().$("#keepHint").getProperty("textContent")).toBe(
      "Cards and settings stay in this browser.",
    );
    await openNewTab(site());
    expect(await profileCards(site())).toEqual(["Quad9"]);
  });

  it("takes them out of the browser again when told to forget", async () => {
    await site().url(SITE);
    await addPreset(site(), "Quad9");
    await setForgetOnClose(site(), false);

    await setForgetOnClose(site(), true);

    expect(await storedKeys(site())).toMatchObject({ browser: [] });
    expect((await storedKeys(site())).tab).toContain(CONFIGS);
    expect(await site().$("#keepHint").getProperty("textContent")).toBe(
      "Deletes cards and settings. For zero traces, use a private window.",
    );
    await openNewTab(site());
    expect(await profileCards(site())).toEqual([]);
  });
});
