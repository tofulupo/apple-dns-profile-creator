import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { profileFilename, safeStem } from "../../src/lib/filename.ts";
import { config } from "../helpers/configs.ts";

const plain = { signed: false, neutral: false };

describe("profileFilename", () => {
  it("names a profile with one configuration after it", () => {
    expect(profileFilename([config({ name: "DNS Bunker" })], plain))
      .toBe("dns-bunker.mobileconfig");
  });

  it("turns accents, slashes and spaces into lowercase ASCII and hyphens", () => {
    expect(profileFilename([config({ name: "Mein Profil ü/2" })], plain))
      .toBe("mein-profil-u-2.mobileconfig");
  });

  it("falls back to encrypted-dns when no ASCII letter or digit is left", () => {
    for (const name of ["", "日本", "🛡️", "---"]) {
      expect(profileFilename([config({ name })], plain))
        .toBe("encrypted-dns.mobileconfig");
    }
  });

  it("uses encrypted-dns for several configurations, one name for twins", () => {
    expect(profileFilename(
      [config({ name: "Quad9" }), config({ name: "DNS Bunker" })],
      plain,
    )).toBe("encrypted-dns.mobileconfig");
    expect(profileFilename(
      [
        config({ name: "Quad9", paradigm: "payload" }),
        config({ name: "Quad9", paradigm: "declarations" }),
      ],
      plain,
    )).toBe("quad9.mobileconfig");
  });

  it("adds -signed to the same stem", () => {
    expect(profileFilename(
      [config({ name: "DNS Bunker" })],
      { signed: true, neutral: false },
    )).toBe("dns-bunker-signed.mobileconfig");
  });

  it("keeps the neutral names when asked to", () => {
    const configs = [config({ name: "DNS Bunker" })];
    expect(profileFilename(configs, { signed: false, neutral: true }))
      .toBe("encrypted-dns.mobileconfig");
    expect(profileFilename(configs, { signed: true, neutral: true }))
      .toBe("encrypted-dns-signed.mobileconfig");
  });
});

describe("safeStem", () => {
  it("cuts a long name at a hyphen, at 40 characters at most", () => {
    const stem = safeStem(
      "A very long provider name that goes on and on forever",
    );
    expect(stem).toBe("a-very-long-provider-name-that-goes-on");
    expect(stem.length).toBeLessThanOrEqual(40);
  });
});
