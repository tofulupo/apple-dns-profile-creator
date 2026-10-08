import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { buildProfileXml } from "../../src/lib/profile.ts";
import { readFontProfile, readProfileFile } from "../../src/ui/dropzone.ts";
import { config } from "../helpers/configs.ts";
import { stubUuid } from "../helpers/uuid.ts";

function profileFile(name: string, systemScope = true): File {
  const xml = buildProfileXml(
    [config(), config({ name: "Two" })],
    { systemScope, identifierPrefix: "com.example." },
    stubUuid(),
  );
  return new File([xml], name);
}

describe("readProfileFile", () => {
  it("marks each configuration with the file it came from", async () => {
    const { configs } = await readProfileFile(
      profileFile("encrypted-dns 3.mobileconfig"),
    );
    const [first, second] = configs.map((c) => c.source);
    expect(first?.file).toBe("encrypted-dns 3.mobileconfig");
    expect(first?.profileId).toMatch(/^com\.example\./);
    expect(first?.systemScope).toBe(true);
    expect(first?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toEqual(first);
  });

  it("leaves a font profile to the font panel", async () => {
    const bytes = await Deno.readFile(FONTS);
    await expect(readProfileFile(new File([bytes], "fonts.mobileconfig")))
      .rejects.toThrow("That profile contains no DNS settings.");
  });

  it("hashes the content, not the name", async () => {
    const a = await readProfileFile(profileFile("a.mobileconfig"));
    const b = await readProfileFile(profileFile("b.mobileconfig"));
    const user = await readProfileFile(profileFile("c.mobileconfig", false));
    expect(a.configs[0]?.source?.sha256).toBe(b.configs[0]?.source?.sha256);
    expect(a.configs[0]?.source?.sha256).not.toBe(
      user.configs[0]?.source?.sha256,
    );
  });
});

const FONTS = new URL(
  "../../src-tauri/tests/fixtures/fonts.mobileconfig",
  import.meta.url,
);

describe("readFontProfile", () => {
  it("hashes a dropped file the way shasum -a 256 does", async () => {
    const bytes = await Deno.readFile(FONTS);
    const profile = await readFontProfile(
      new File([bytes], "fonts.mobileconfig"),
    );
    const shasum = new Deno.Command("shasum", {
      args: ["-a", "256", FONTS.pathname],
    }).outputSync();
    const expected = new TextDecoder().decode(shasum.stdout).split(" ")[0];
    expect(profile?.sha256).toBe(expected);
    expect(profile?.fonts).toBe(2);
    expect(profile?.file).toBe("fonts.mobileconfig");
  });

  it("is undefined for a DNS profile, and throws for a bad font", async () => {
    expect(await readFontProfile(profileFile("dns.mobileconfig")))
      .toBeUndefined();
    const text = (await Deno.readTextFile(FONTS))
      .replace("T1RUTwAAAAA=", "dHRjZgAAAAA=");
    await expect(readFontProfile(new File([text], "ttc.mobileconfig")))
      .rejects.toThrow("collection");
  });
});
