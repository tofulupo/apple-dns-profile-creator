import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { type Browser, cardNames, loadFile, SITE, useSite } from "./site.ts";

const MULLVAD_WITH_RULES = Deno.readTextFileSync(
  new URL("../fixtures/own/mullvad-with-rules.mobileconfig", import.meta.url),
);

/** Picks the preset and confirms its question, returning the question. */
async function pickPreset(browser: Browser, preset: string): Promise<string> {
  const asked = new Promise<string>((resolve) => {
    browser.once("dialog", async (dialog) => {
      resolve(dialog.message());
      await dialog.accept();
    });
  });
  await browser.$("#presetToggle").click();
  await browser.$("#presetMenu").$(`button*=${preset}`).click();
  return asked;
}

function form(browser: Browser) {
  return browser.execute(() => {
    const value = (id: string) =>
      (document.getElementById(id) as HTMLInputElement).value;
    const checked = (id: string) =>
      (document.getElementById(id) as HTMLInputElement).checked;
    return {
      name: value("provName"),
      server: value("serverUrl"),
      wifi: value("exclWifi"),
      domains: value("exclDomains"),
      ethernet: checked("useEthernet"),
      failover: checked("allowFailover"),
      submit: document.getElementById("btn_addToProfile")?.textContent?.trim(),
    };
  });
}

describe({
  name: "moving a loaded profile to another resolver",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  const site = useSite();

  beforeEach(async () => {
    await site().url(SITE);
    await site().execute(() => {
      sessionStorage.clear();
      localStorage.clear();
    });
    await site().url(SITE);
  });

  it("keeps the rules, takes the preset's name and replaces the card", async () => {
    await loadFile(
      site(),
      "mullvad-with-rules.mobileconfig",
      MULLVAD_WITH_RULES,
    );
    await site().waitUntil(async () =>
      (await form(site())).submit === "Save changes"
    );

    expect(await pickPreset(site(), "Quad9")).toBe(
      "Replace the provider name and server with Quad9? The resolver addresses will be replaced.",
    );

    await site().waitUntil(async () => (await form(site())).name === "Quad9");
    expect(await form(site())).toEqual({
      name: "Quad9",
      server: "https://dns.quad9.net/dns-query",
      wifi: "Home Fritzbox\nOffice Guest",
      domains: "fritz.box",
      ethernet: false,
      failover: true,
      submit: "Save changes",
    });

    await site().$("#btn_addToProfile").click();
    await site().$("#configList").waitForDisplayed();
    expect(await cardNames(site())).toEqual(["Quad9"]);
    expect(await site().$(".profile-card__edited").isExisting()).toBe(true);
  });

  it("keeps a name the user typed over the one from the file", async () => {
    await loadFile(
      site(),
      "mullvad-with-rules.mobileconfig",
      MULLVAD_WITH_RULES,
    );
    await site().waitUntil(async () =>
      (await form(site())).submit === "Save changes"
    );
    await site().$("#provName").setValue("Family phones");

    expect(await pickPreset(site(), "Quad9")).toBe(
      "Replace the server with Quad9? The name you entered stays. The resolver addresses will be replaced.",
    );

    await site().waitUntil(async () =>
      (await form(site())).server === "https://dns.quad9.net/dns-query"
    );
    expect((await form(site())).name).toBe("Family phones");
  });
});
