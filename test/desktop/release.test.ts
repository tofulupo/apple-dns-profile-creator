/**
 * Tests for `deno task desktop:release`: the checks it makes before a long
 * build, and the names the DMGs are published under.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  identityProblem,
  missingSettings,
  releaseName,
  TARGETS,
} from "../../scripts/desktop_release.ts";

const complete = {
  APPLE_SIGNING_IDENTITY: "DB6F36187634D70F89F3AEFC43EC489F2AD18AE5",
  APPLE_API_ISSUER: "69a6de70-0000-0000-0000-000000000000",
  APPLE_API_KEY: "ABC123DEFG",
  APPLE_API_KEY_PATH: "/Users/someone/keys/AuthKey_ABC123DEFG.p8",
};

describe("missingSettings", () => {
  it("wants the identity and the API key for a release", () => {
    expect(missingSettings(complete, false)).toEqual([]);
    expect(missingSettings({}, false)).toEqual([
      "APPLE_SIGNING_IDENTITY",
      "APPLE_API_ISSUER",
      "APPLE_API_KEY",
      "APPLE_API_KEY_PATH",
    ]);
  });

  it("wants only the identity to sign without notarizing", () => {
    expect(missingSettings({ APPLE_SIGNING_IDENTITY: "DB6F" }, true))
      .toEqual([]);
  });

  // What an unfilled line in .env.release gives.
  it("counts a blank value as missing", () => {
    expect(missingSettings({ ...complete, APPLE_API_KEY: " " }, false))
      .toEqual(["APPLE_API_KEY"]);
  });
});

describe("identityProblem", () => {
  it("refuses the ad-hoc identity, which only opens on this Mac", () => {
    expect(identityProblem("-")).not.toBeNull();
  });

  it("accepts a certificate", () => {
    expect(identityProblem(complete.APPLE_SIGNING_IDENTITY)).toBeNull();
  });
});

describe("releaseName", () => {
  // Spaces would have to be escaped in the release URL and the cask.
  it("names each DMG by version and architecture, without spaces", () => {
    expect(TARGETS.map(({ arch }) => releaseName("4.0.0", arch))).toEqual([
      "DNS-Profile-Creator-4.0.0-arm64.dmg",
      "DNS-Profile-Creator-4.0.0-x86_64.dmg",
    ]);
  });
});
