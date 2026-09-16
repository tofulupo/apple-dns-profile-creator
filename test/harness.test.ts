/**
 * These tests assert that the fixture corpus loads and has the shape the
 * specification tests rely on.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  extractedFixtures,
  hasSignedFixtures,
  looksLikeDer,
  plainXmlFixtures,
  signedFixtures,
} from "./helpers/fixtures.ts";

describe("plain XML fixture corpus", () => {
  const fixtures = plainXmlFixtures();

  it("is present", () => {
    expect(fixtures.length).toBeGreaterThan(0);
  });

  for (const f of fixtures) {
    it(`${f.name} is a well-formed Apple plist document`, () => {
      expect(looksLikeDer(f.text)).toBe(false);
      expect(f.text).toContain("<!DOCTYPE plist");
      expect(f.text).toContain('<plist version="1.0">');
      expect(f.text.trimEnd().endsWith("</plist>")).toBe(true);
    });

    it(`${f.name} carries a managed DNS payload`, () => {
      expect(f.text).toContain("com.apple.dnsSettings.managed");
      expect(f.text).toMatch(/<string>(HTTPS|TLS)<\/string>/);
    });
  }

  it("covers both transports", () => {
    const protocols = new Set(
      fixtures.flatMap((f) =>
        [
          ...f.text.matchAll(
            /<key>DNSProtocol<\/key>\s*<string>(\w+)<\/string>/g,
          ),
        ]
          .map((m) => m[1])
          .filter((p): p is string => p !== undefined)
      ),
    );
    expect(protocols).toEqual(new Set(["HTTPS", "TLS"]));
  });

  it("includes exactly one profile carrying OnDemandRules", () => {
    const withRules = fixtures.filter((f) => f.text.includes("OnDemandRules"));
    expect(withRules.map((f) => f.name)).toEqual([
      "template-on-demand-default-https",
    ]);
  });

  it("has no upstream coverage for excluded domains or multi-payload profiles", () => {
    expect(fixtures.filter((f) => f.text.includes("EvaluateConnection")))
      .toEqual([]);
    for (const f of fixtures) {
      const payloads = f.text.match(/com\.apple\.dnsSettings\.managed</g) ?? [];
      expect(payloads.length).toBe(1);
    }
  });
});

if (hasSignedFixtures()) {
  describe("signed fixture corpus", () => {
    it("is DER, not XML", () => {
      for (const f of signedFixtures()) {
        expect(looksLikeDer(f.text)).toBe(true);
      }
    });

    it("embeds the plist as recoverable text", () => {
      for (const f of signedFixtures()) {
        const match = /<!DOCTYPE plist.+<\/plist>/s.exec(f.text);
        expect(match).not.toBeNull();
      }
    });

    it("has a pre-extracted inner plist per signed profile", () => {
      expect(extractedFixtures().length).toBe(signedFixtures().length);
      for (const f of extractedFixtures()) {
        expect(looksLikeDer(f.text)).toBe(false);
        expect(f.text).toContain("<!DOCTYPE plist");
      }
    });
  });
}
