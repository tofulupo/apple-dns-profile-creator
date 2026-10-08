import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  checkFontProfile,
  COLLECTION,
  MIXED,
  NOT_A_FONT,
  UNIDENTIFIED,
  WEB_FONT,
} from "../../src/lib/fonts.ts";

const FONTS = await Deno.readTextFile(
  new URL("../../src-tauri/tests/fixtures/fonts.mobileconfig", import.meta.url),
);
/** The OpenType font's data in FONTS. */
const OTF = "<data>T1RUTwAAAAA=</data>";

describe("checkFontProfile", () => {
  it("accepts TrueType and OpenType fonts and counts them", () => {
    expect(checkFontProfile(FONTS)).toEqual({ valid: true, fonts: 2 });
    expect(checkFontProfile(FONTS.replace(OTF, "<data>dHJ1ZQAAAAA=</data>")))
      .toEqual({ valid: true, fonts: 2 });
  });

  it("refuses collections and web fonts", () => {
    for (
      const [data, error] of [
        ["dHRjZgAAAAA=", COLLECTION],
        ["d09GRgAAAAA=", WEB_FONT],
        ["d09GMgAAAAA=", WEB_FONT],
      ]
    ) {
      expect(checkFontProfile(FONTS.replace(OTF, `<data>${data}</data>`)))
        .toEqual({ valid: false, error });
    }
  });

  it("refuses a missing or empty font", () => {
    const missing = FONTS.replace(`<key>Font</key>\n\t\t\t${OTF}`, "");
    expect(missing).not.toBe(FONTS);
    for (const xml of [FONTS.replace(OTF, "<data></data>"), missing]) {
      expect(checkFontProfile(xml)).toEqual({
        valid: false,
        error: NOT_A_FONT,
      });
    }
  });

  it("refuses fonts mixed with other payloads", () => {
    const mixed = FONTS.replace(
      "<string>com.apple.font</string>",
      "<string>com.apple.dnsSettings.managed</string>",
    );
    expect(checkFontProfile(mixed)).toEqual({ valid: false, error: MIXED });
  });

  it("refuses fonts without identifier, UUID or version", () => {
    for (const key of ["PayloadIdentifier", "PayloadUUID", "PayloadVersion"]) {
      const xml = FONTS.replace(`<key>${key}</key>`, "<key>Unknown</key>");
      expect(checkFontProfile(xml)).toEqual({
        valid: false,
        error: UNIDENTIFIED,
      });
    }
  });

  it("leaves profiles without fonts to the DNS import", () => {
    expect(checkFontProfile(FONTS.replaceAll("com.apple.font", "com.x"))).toBe(
      undefined,
    );
    expect(checkFontProfile("not a profile")).toBe(undefined);
  });
});
