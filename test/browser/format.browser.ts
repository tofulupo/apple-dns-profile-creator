import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { type Browser, loadFile, SITE, useSite } from "./site.ts";

const DECLARATIONS = Deno.readTextFileSync(
  new URL(
    "../../src-tauri/tests/fixtures/declarations.mobileconfig",
    import.meta.url,
  ),
);
const LEGACY = Deno.readTextFileSync(
  new URL("../fixtures/own/mullvad-with-rules.mobileconfig", import.meta.url),
);

function downloadSwitches(browser: Browser) {
  return browser.execute(() => {
    const input = (id: string) =>
      document.getElementById(id) as HTMLInputElement;
    return {
      declarations: input("declarationsChk").checked,
      system: input("systemChk").checked,
      systemLocked: input("systemChk").disabled,
    };
  });
}

describe({
  name: "the format of a loaded profile",
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

  it("turns the Declaration format switch on for a file in that format", async () => {
    await loadFile(site(), "declarations.mobileconfig", DECLARATIONS);
    await site().waitUntil(async () =>
      (await site().getUrl()).endsWith("/finalize.html")
    );
    await site().$("#declarationsChk").waitForExist();
    expect(await downloadSwitches(site())).toEqual({
      declarations: true,
      system: true,
      systemLocked: true,
    });
  });

  it("leaves it off for a legacy file", async () => {
    await loadFile(site(), "mullvad-with-rules.mobileconfig", LEGACY);
    await site().waitUntil(async () =>
      (await site().$("#btn_addToProfile").getText()).includes("Save changes")
    );
    await site().url(`${SITE}finalize.html`);
    await site().$("#declarationsChk").waitForExist();
    expect((await downloadSwitches(site())).declarations).toBe(false);
  });
});
