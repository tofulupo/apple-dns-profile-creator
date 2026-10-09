import { beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { addPreset, type App, cardNames, press, useApp } from "./app.ts";

const FAILOVER = "Office MacBook DoH Failover";

async function twoCards(app: App): Promise<void> {
  await addPreset(app, "Quad9");
  await app.$("nav.tabs").$("a*=Tool").click();
  await addPreset(app, "Quad9", async () => {
    await app.$("#provName").setValue(FAILOVER);
    await app.$("#disclosure-rules > summary").click();
    await press(app.$("label*=Cellular"));
    await press(app.$("#allowFailover"));
  });
}

async function compareBoth(app: App): Promise<void> {
  const compare = (index: number) =>
    app.$$("#dynamicList .profile-card__compare")[index]!.click();
  await compare(0);
  await compare(1);
  await app.$("#compareView").waitForDisplayed();
}

describe({
  name: "comparing two cards",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  const app = useApp();

  beforeEach(async () => {
    await twoCards(app());
  });

  it("shows them side by side, marks each row that differs and counts the differences", async () => {
    await compareBoth(app());

    const [a, b] = await app().$$("#compareView thead th");
    expect(await a!.getText()).toBe("A · Quad9");
    expect(await b!.getText()).toBe(`B · ${FAILOVER}`);
    const left = await a!.getLocation();
    const right = await b!.getLocation();
    expect(right.y).toBe(left.y);
    expect(right.x).toBeGreaterThan(left.x);

    const marked = await app().execute(() =>
      [...document.querySelectorAll("#compareView .compare__row--differs th")]
        .map((th) => th.firstChild?.textContent)
    );
    expect(marked).toEqual(["Interfaces", "Rules"]);
    expect(await app().$("#compareSummary").getText()).toBe("2 differences");
  });

  it("shows the list again after closing, with the same cards in the same order", async () => {
    const before = await cardNames(app());
    await compareBoth(app());

    await app().$("#compareClose").click();

    await app().$("#configList").waitForDisplayed();
    expect(await app().$("#compareView").isDisplayed()).toBe(false);
    expect(await cardNames(app())).toEqual(before);
    expect(before).toEqual(["Quad9", FAILOVER]);
  });
});
