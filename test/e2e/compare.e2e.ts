import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { addPreset, type App, cardNames, press, useApp } from "./app.ts";

const FAILOVER = "Office MacBook DoH Failover";

async function twoCards(
  app: App,
  name: string,
  adjust: () => Promise<void> = async () => {},
): Promise<void> {
  await addPreset(app, "Quad9");
  await app.$("nav.tabs").$("a*=Tool").click();
  await addPreset(app, "Quad9", async () => {
    await app.$("#provName").setValue(name);
    await adjust();
  });
}

function twoDifferentCards(app: App): Promise<void> {
  return twoCards(app, FAILOVER, async () => {
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

function shownFields(app: App): Promise<string[]> {
  return app.execute(() =>
    [...document.querySelectorAll("#compareView .compare__field")]
      .filter((field) => getComputedStyle(field).display !== "none")
      .map((field) =>
        field.querySelector(".compare__label-name")?.textContent ?? ""
      )
  );
}

describe({
  name: "comparing two cards",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  const app = useApp();

  it("shows them side by side, opens on the differences and counts them", async () => {
    await twoDifferentCards(app());
    await compareBoth(app());

    const [a, b] = await app().$$("#compareView thead .compare-head__name");
    expect(await a!.getText()).toBe("Quad9");
    expect(await b!.getText()).toBe(FAILOVER);
    const left = await a!.getLocation();
    const right = await b!.getLocation();
    expect(right.y).toBe(left.y);
    expect(right.x).toBeGreaterThan(left.x);

    expect(await shownFields(app())).toEqual(["Interfaces", "Rules"]);
    const details = await app().execute(() =>
      [...document.querySelectorAll("#compareView .compare__label")]
        .map((label) => label.querySelector(".compare-detail")?.textContent)
        .filter((detail) => detail !== undefined)
    );
    expect(details).toEqual(["Cellular only in A", "Failover only in B"]);
    expect(
      await app().$("#compareView .compare__wide").$("button*=Only differences")
        .getText(),
    ).toBe("Only differences 2");
    expect(
      await app().execute(() =>
        document.getElementById("compareSummary")?.textContent
      ),
    ).toBe("2 differences");

    await app().$("#compareView .compare__wide").$("button*=All").click();
    expect(await shownFields(app())).toHaveLength(11);
  });

  it("says so when nothing differs, and shows every field on request", async () => {
    await twoCards(app(), "Quad9 at home");
    await compareBoth(app());

    const wide = app().$("#compareView .compare__wide");
    expect(await wide.$(".compare-filter__none").getText()).toBe(
      "No differences in 11 fields",
    );
    expect(await shownFields(app())).toEqual([]);

    await wide.$("button=Show all 11").click();
    expect(await shownFields(app())).toHaveLength(11);
  });

  it("shows the list again after closing, with the same cards in the same order", async () => {
    await twoDifferentCards(app());
    const before = await cardNames(app());
    await compareBoth(app());

    await app().$("#compareClose").click();

    await app().$("#configList").waitForDisplayed();
    expect(await app().$("#compareView").isDisplayed()).toBe(false);
    expect(await cardNames(app())).toEqual(before);
    expect(before).toEqual(["Quad9", FAILOVER]);
  });
});
