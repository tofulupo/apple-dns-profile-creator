import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  addPreset,
  type App,
  cardNames,
  filesHolding,
  inSettings,
  onX11,
  openTab,
  press,
  readAppSettings,
  saveAppSettings,
  useApp,
} from "./app.ts";

async function addCardWithWifi(app: App, ssid: string): Promise<void> {
  await addPreset(app, "Quad9", async () => {
    await press(app.$("#disclosure-rules > summary"));
    await press(app.$(".rule-list").$("summary*=Wi-Fi exceptions"));
    await app.$("#exclWifi").setValue(ssid);
  });
}

function forgetSwitch(app: App) {
  return app.execute(() => {
    const note = document.getElementById("forgetNote");
    return {
      on: (document.getElementById("forgetChk") as HTMLInputElement).checked,
      hint: document.getElementById("forgetHint")?.textContent,
      note: note?.hidden ? null : note?.textContent,
    };
  });
}

function root(app: App) {
  return app.execute(() => ({
    theme: document.documentElement.dataset["theme"],
    motion: document.documentElement.dataset["motion"],
  }));
}

describe({
  name: "the Settings window",
  ignore: !onX11,
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  const app = useApp();

  it("shows the saved choice for Forget on quit", async () => {
    await inSettings(app(), async () => {
      expect(await forgetSwitch(app())).toEqual({
        on: false,
        hint: "Deletes cards and signing choices.",
        note: null,
      });
    });
  });

  it("forgets the cards from the next start once turned on", async () => {
    await addCardWithWifi(app(), "Airport Lounge");
    await app.restart();
    expect(filesHolding("Airport Lounge")).not.toEqual([]);

    await inSettings(app(), async () => {
      await press(app().$("#forgetChk"));
      expect(await forgetSwitch(app())).toMatchObject({
        on: true,
        note: "Applies from the next start.",
      });
    });
    expect(readAppSettings()).toMatchObject({ forgetOnQuit: true });

    await app.launchUndriven();

    expect(filesHolding("Airport Lounge")).toEqual([]);
    await saveAppSettings({ forgetOnQuit: false });
    await app.restart();
    await openTab(app(), "Profile");
    await app().$("main").waitForExist();
    expect(await cardNames(app())).toEqual([]);
  });

  it("keeps the cards when turned off again", async () => {
    await saveAppSettings({ forgetOnQuit: false });
    await app.restart();
    await addCardWithWifi(app(), "Train Wifi");

    await inSettings(app(), async () => {
      await press(app().$("#forgetChk"));
      await press(app().$("#forgetChk"));
      expect(await forgetSwitch(app())).toMatchObject({
        on: false,
        note: null,
      });
    });
    expect(readAppSettings()).toMatchObject({ forgetOnQuit: false });

    await app.restart();

    await openTab(app(), "Profile");
    await app().$("main").waitForExist();
    expect(await cardNames(app())).toEqual(["Quad9"]);
  });

  it("applies theme and motion to the main window at once and after a restart", async () => {
    await saveAppSettings({ forgetOnQuit: false });
    await app.restart();
    await inSettings(app(), async () => {
      await press(app().$("label.theme-card*=Dark"));
      await press(app().$("label.segmented__option*=Reduced"));
    });
    await app().waitUntil(async () =>
      (await root(app())).theme === "dark" &&
      (await root(app())).motion === "reduce"
    );
    expect(readAppSettings()).toMatchObject({
      theme: "dark",
      motion: "reduce",
    });

    await app.restart();

    expect(await root(app())).toEqual({ theme: "dark", motion: "reduce" });
  });
});
