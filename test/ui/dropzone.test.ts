import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { buildProfileXml } from "../../src/lib/profile.ts";
import {
  DAMAGED,
  loadProfileFile,
  MAX_PROFILE_BYTES,
  NO_DNS_SETTINGS,
  NOT_A_PROFILE,
  type OpenDropped,
  readFontProfile,
  readProfileFile,
  sha256,
  TOO_LARGE,
  UNREADABLE,
  unwrapDropped,
  uploadError,
} from "../../src/ui/dropzone.ts";
import { MAX_NESTING } from "../../src/lib/xml.ts";
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
      .rejects.toThrow(NO_DNS_SETTINGS);
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

/** A file that records whether anything read its contents. */
class WatchedFile extends File {
  read = false;
  override text(): Promise<string> {
    this.read = true;
    return super.text();
  }
  override arrayBuffer(): Promise<ArrayBuffer> {
    this.read = true;
    return super.arrayBuffer();
  }
}

describe("the size limit", () => {
  const huge = () =>
    new WatchedFile(
      [new Uint8Array(MAX_PROFILE_BYTES + 1)],
      "huge.mobileconfig",
    );

  it("refuses a file over the limit without reading it", async () => {
    for (
      const read of [
        readProfileFile,
        readFontProfile,
        (file: File) => unwrapDropped(file, undefined),
      ]
    ) {
      const file = huge();
      await expect(read(file)).rejects.toThrow(TOO_LARGE);
      expect(file.read).toBe(false);
    }
  });

  it("still loads a profile at the limit", async () => {
    const xml = await profileFile("padded.mobileconfig").text();
    const padded = xml + " ".repeat(
      MAX_PROFILE_BYTES - new TextEncoder().encode(xml).length,
    );
    const file = new File([padded], "padded.mobileconfig");
    expect(file.size).toBe(MAX_PROFILE_BYTES);
    const { configs } = await readProfileFile(file);
    expect(configs).toHaveLength(2);
  });

  it("is the app's limit for opened files and signing", async () => {
    const rust = await Deno.readTextFile(
      new URL("../../src-tauri/src/opened.rs", import.meta.url),
    );
    const [, mebibytes] =
      /pub const MAX_PROFILE_BYTES: u64 = (\d+) \* 1024 \* 1024;/.exec(rust) ??
        [];
    expect(Number(mebibytes) * 1024 * 1024).toBe(MAX_PROFILE_BYTES);
  });
});

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
    expect(await unwrapDropped(file, open)).toEqual({
      file,
      signature: "none",
    });
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
    expect(unwrapped?.signature).toBe("unknown");
    expect(unwrapped?.file.name).toBe("signed.mobileconfig");
    expect(await unwrapped?.file.text()).toBe(xml);
  });

  it("loads nothing when the user doesn't open a broken signature", async () => {
    const bytes = await Deno.readFile(SIGNED);
    const { open } = app(null);
    expect(await unwrapDropped(new File([bytes], "signed.mobileconfig"), open))
      .toBeUndefined();
  });

  it("has the app check a signed profile with anything in front", async () => {
    const signed = await Deno.readFile(SIGNED);
    for (const prefix of [[0xef, 0xbb, 0xbf], [0x0a], [0x20, 0x0d, 0x0a]]) {
      const { open, calls } = app(null);
      const file = new File(
        [new Uint8Array([...prefix, ...signed])],
        "edited.mobileconfig",
      );
      expect(await unwrapDropped(file, open)).toBeUndefined();
      expect(calls).toHaveLength(1);
    }
  });

  it("refuses a file that is neither a plain nor a signed profile", async () => {
    const signed = await Deno.readFile(SIGNED);
    for (
      const bytes of [
        new Uint8Array([...new TextEncoder().encode("junk"), ...signed]),
        new Uint8Array(),
      ]
    ) {
      const { open, calls } = app("<plist/>");
      await expect(unwrapDropped(new File([bytes], "x.mobileconfig"), open))
        .rejects.toThrow(NOT_A_PROFILE);
      expect(calls).toEqual([]);
    }
  });

  it("reads a plain profile saved with a byte order mark as plain", async () => {
    const xml = await profileFile("plain.mobileconfig").text();
    const file = new File(["\ufeff\n" + xml], "bom.mobileconfig");
    const { open, calls } = app(null);
    expect(await unwrapDropped(file, open)).toEqual({
      file,
      signature: "none",
    });
    expect(calls).toEqual([]);
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

  it("says on the website that the signature isn't checked", async () => {
    const file = new File([await Deno.readFile(SIGNED)], "signed.mobileconfig");
    expect(await unwrapDropped(file, undefined)).toEqual({
      file,
      signature: "unchecked",
    });
    const { configs } = await readProfileFile(file);
    expect(configs.map((config) => config.name)).toEqual([
      "Quad9 Encrypted DNS over TLS",
    ]);
  });
});

describe("uploadError", () => {
  async function refusal(text: string): Promise<string> {
    const error = await readProfileFile(new File([text], "x.mobileconfig"))
      .catch((error: unknown) => error);
    return uploadError(error);
  }

  it("says the same plain sentence for every broken file", async () => {
    const nested = "<plist>" + "<array>".repeat(MAX_NESTING + 1) +
      "</array>".repeat(MAX_NESTING + 1) + "</plist>";
    for (
      const text of [
        "",
        "bplist00\u0000\u0001",
        "<plist><dict><string>a</string></dict></plist>",
        "<plist><array></array></plist>",
        "<plist><dict><key>PayloadContent</key><string/></dict></plist>",
        nested,
      ]
    ) {
      expect(await refusal(text)).toBe(DAMAGED);
    }
  });

  it("names the problem and what to do next", () => {
    for (const text of [TOO_LARGE, NOT_A_PROFILE, DAMAGED, NO_DNS_SETTINGS]) {
      expect(text).toMatch(/^This .+\. Try (a|another) .+\.$/);
    }
    expect(UNREADABLE).toBe("Couldn't read this file. Try loading it again.");
  });

  it("keeps the reason of a refusal it knows", () => {
    expect(uploadError(new Error(TOO_LARGE))).toBe(TOO_LARGE);
    expect(uploadError("not an Error")).toBe(UNREADABLE);
  });
});

describe("loadProfileFile", () => {
  it("finds a signed file with the legacy payload on the website", async () => {
    const file = new File([await Deno.readFile(SIGNED)], "signed.mobileconfig");
    const loaded = await loadProfileFile(file, true, undefined);
    expect(loaded?.facts).toEqual({
      file: "signed.mobileconfig",
      configs: 1,
      signature: "unchecked",
      legacy: true,
      dot: 1,
      mullvad: false,
      leftOut: [],
    });
    expect(loaded?.configs).toHaveLength(1);
  });

  it("finds an unsigned file with declarations", async () => {
    const xml = buildProfileXml(
      [config(), config({ name: "Two" })],
      { systemScope: true, format: "declarations" },
      stubUuid(),
    );
    const loaded = await loadProfileFile(
      new File([xml], "new.mobileconfig"),
      true,
      undefined,
    );
    expect(loaded?.facts).toEqual({
      file: "new.mobileconfig",
      configs: 2,
      signature: "none",
      legacy: false,
      dot: 2,
      mullvad: false,
      leftOut: [],
    });
  });

  it("finds a profile on Mullvad's servers", async () => {
    const xml = await Deno.readTextFile(
      new URL(
        "../fixtures/own/mullvad-with-rules.mobileconfig",
        import.meta.url,
      ),
    );
    const loaded = await loadProfileFile(
      new File([xml], "mullvad.mobileconfig"),
      true,
      undefined,
    );
    expect(loaded?.facts.mullvad).toBe(true);
  });

  it("passes on what the import left out", async () => {
    const xml = (await profileFile("wifi.mobileconfig").text()).replace(
      "<key>PayloadContent</key>\n\t<array>",
      "<key>PayloadContent</key>\n\t<array>\n\t\t<dict><key>PayloadType</key>" +
        "<string>com.apple.wifi.managed</string></dict>",
    );
    const loaded = await loadProfileFile(
      new File([xml], "wifi.mobileconfig"),
      true,
      undefined,
    );
    expect(loaded?.facts.leftOut).toEqual([
      "Skipped payloads that are not DNS settings: com.apple.wifi.managed.",
    ]);
  });

  it("leaves the signature of a file the app opened to the app", async () => {
    const loaded = await loadProfileFile(
      profileFile("opened.mobileconfig"),
      false,
      undefined,
    );
    expect(loaded?.facts.signature).toBe("unknown");
  });

  it("is undefined when the user doesn't open a broken signature", async () => {
    const file = new File([await Deno.readFile(SIGNED)], "signed.mobileconfig");
    expect(await loadProfileFile(file, true, () => Promise.resolve(null)))
      .toBeUndefined();
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
