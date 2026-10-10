import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  addPreset,
  type App,
  cardNames,
  filesHolding,
  openTab,
  press,
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

async function profileCards(app: App): Promise<string[]> {
  await openTab(app, "Profile");
  await app.$("main").waitForExist();
  return cardNames(app);
}

describe({
  name: "what the app keeps between launches",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  const app = useApp();

  it("keeps the cards when told to", async () => {
    await saveAppSettings({ forgetOnQuit: false });
    await addCardWithWifi(app(), "Office Guest");

    await app.restart();

    expect(await profileCards(app())).toEqual(["Quad9"]);
    expect(filesHolding("Office Guest")).not.toEqual([]);
  });

  it("forgets the cards unless told otherwise", async () => {
    await saveAppSettings({ forgetOnQuit: false });
    await addCardWithWifi(app(), "Hotel Lobby");
    await app.restart();
    expect(filesHolding("Hotel Lobby")).not.toEqual([]);

    await saveAppSettings({});
    await app.launchUndriven();

    expect(filesHolding("Hotel Lobby")).toEqual([]);

    await saveAppSettings({ forgetOnQuit: false });
    await app.restart();
    expect(await profileCards(app())).toEqual([]);
  });

  it("puts the saved theme and motion into a new window", async () => {
    await saveAppSettings({
      theme: "dark",
      motion: "reduce",
      forgetOnQuit: false,
    });

    await app.restart();

    const root = await app().execute(() => ({
      theme: document.documentElement.dataset["theme"],
      motion: document.documentElement.dataset["motion"],
    }));
    expect(root).toEqual({ theme: "dark", motion: "reduce" });
  });
});
