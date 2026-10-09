import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { buildProfileXml } from "../../src/lib/profile.ts";
import {
  type OpenDropped,
  readFontProfile,
  readProfileFile,
  sha256,
  UNCHECKED_SIGNATURE_NOTE,
  unwrapDropped,
  uploadError,
} from "../../src/ui/dropzone.ts";
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

  it("hashes a saved profile the way it hashed it when saving", async () => {
    const file = profileFile("quad9.mobileconfig");
    const { configs } = await readProfileFile(file);
    expect(configs[0]?.source?.sha256).toBe(await sha256(await file.text()));
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
const SIGNED = new URL(
  "../../src-tauri/tests/fixtures/signed.mobileconfig",
  import.meta.url,
);

describe("unwrapDropped", () => {
  function app(answer: string | null) {
    const calls: { name: string; bytes: Uint8Array }[] = [];
    const open: OpenDropped = (name, bytes) => {
      calls.push({ name, bytes });
      return Promise.resolve(answer);
    };
    return { open, calls };
  }

  it("passes a plain profile through without asking the app", async () => {
    const file = profileFile("plain.mobileconfig");
    const { open, calls } = app(null);
    expect(await unwrapDropped(file, open)).toEqual({ file, notes: [] });
    expect(calls).toEqual([]);
  });

  it("has the app check a signed profile and reads what it hands back", async () => {
    const bytes = await Deno.readFile(SIGNED);
    const xml = await profileFile("inside.mobileconfig").text();
    const { open, calls } = app(xml);
    const unwrapped = await unwrapDropped(
      new File([bytes], "signed.mobileconfig"),
      open,
    );
    expect(calls).toEqual([{ name: "signed.mobileconfig", bytes }]);
    expect(unwrapped?.notes).toEqual([]);
    expect(unwrapped?.file.name).toBe("signed.mobileconfig");
    expect(await unwrapped?.file.text()).toBe(xml);
  });

  it("loads nothing when the user doesn't open a broken signature", async () => {
    const bytes = await Deno.readFile(SIGNED);
    const { open } = app(null);
    expect(await unwrapDropped(new File([bytes], "signed.mobileconfig"), open))
      .toBeUndefined();
  });

  it("shows the app's reason when it refuses the file", async () => {
    const bytes = await Deno.readFile(SIGNED);
    const reason = "Could not open “huge.mobileconfig”.\n\nIt is too large.";
    const open: OpenDropped = () => Promise.reject(reason);
    const error = await unwrapDropped(
      new File([bytes], "huge.mobileconfig"),
      open,
    ).catch((error: unknown) => error);
    expect(uploadError(error)).toBe(reason);
  });

  it("notes on the website that the signature isn't checked", async () => {
    const file = new File([await Deno.readFile(SIGNED)], "signed.mobileconfig");
    expect(await unwrapDropped(file, undefined)).toEqual({
      file,
      notes: [UNCHECKED_SIGNATURE_NOTE],
    });
    const { configs } = await readProfileFile(file);
    expect(configs.map((config) => config.name)).toEqual([
      "Quad9 Encrypted DNS over TLS",
    ]);
  });
});

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
