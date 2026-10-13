import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { addPreset, cardRows, loadFile, press, useApp } from "./app.ts";

const LEGACY = Deno.readTextFileSync(
  new URL("../golden/quad9-default-tls.mobileconfig", import.meta.url),
);

describe({
  name: "fixes since 4.0.0-rc.1",
  sanitizeOps: false,
  sanitizeResources: false,
}, () => {
  const app = useApp();

  it("closes Resolver addresses for a preset without any", async () => {
    await app().$("#presetToggle").click();
    await app().$("#presetMenu").$("button*=Quad9").click();
    expect(await app().$("#addressCount").getText()).toBe("4 addresses");

    await app().$("#presetToggle").click();
    await app().$("#presetMenu").$("button*=HaGeZi").click();

    expect(
      await app().execute(() =>
        (document.getElementById(
          "disclosure-serverAddresses",
        ) as HTMLDetailsElement).open
      ),
    ).toBe(false);
    expect(await app().$("#addressCount").getText()).toBe("None");
  });

  it("only says so for a file already in the profile", async () => {
    const notes = () =>
      app().execute(() =>
        [...document.querySelectorAll("#uploadNotes .file-note__value")].map(
          (value) => value.textContent,
        )
      );
    await loadFile(app(), "quad9.mobileconfig", LEGACY);
    await app().$("#uploadStatus*=Added").waitForExist();
    expect(await notes()).toContain("Legacy payload");

    await loadFile(app(), "quad9.mobileconfig", LEGACY);

    await app().$("#uploadStatus*=Loaded").waitForExist();
    expect(
      await app().execute(() =>
        document.getElementById("uploadStatus")?.textContent
      ),
    ).toBe("Loaded: quad9");
    expect(await notes()).toEqual(["Already in profile"]);
  });

  it("stays usable after a file too large to be a profile", async () => {
    await loadFile(app(), "huge.mobileconfig", " ".repeat(5 * 1024 * 1024 + 1));

    await app().$("#field-fileupload .field__error").waitForDisplayed();
    expect(await app().$("#field-fileupload .field__error").getText()).toBe(
      "This file is too large to be a configuration profile. Try another .mobileconfig file.",
    );
    await addPreset(app(), "Quad9");
    expect(await cardRows(app())).toHaveProperty("Server");
  });

  it("shows interfaces, rules and features on the card", async () => {
    await addPreset(app(), "Quad9", async () => {
      await press(app().$("#disclosure-rules > summary"));
      await press(app().$("label*=Cellular"));
      await press(app().$("#allowFailover"));
    });

    const rows = await cardRows(app());
    expect(rows["Interfaces"]).toEqual(["Wi-Fi", "Ethernet"]);
    expect(rows["Rules"]).toEqual(["Failover"]);
    expect(rows["Features"]).toEqual(["DNSSEC", "Malware blocking"]);
  });
});
