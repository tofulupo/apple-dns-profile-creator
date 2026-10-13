import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import {
  cacheControl,
  CSP_DIRECTIVES,
  DISABLED_FEATURES,
  SECURITY_HEADERS,
  SELF_FEATURES,
} from "../scripts/headers.ts";

describe("cacheControl", () => {
  it("keeps the fingerprinted stylesheet and scripts for good", () => {
    for (const path of ["/app-6a0f56fb.css", "/app-1b2c3d4e.js"]) {
      expect(cacheControl(path)).toBe("public, max-age=31536000, immutable");
    }
  });

  it("keeps fonts and icons for 30 days, without immutable", () => {
    for (
      const path of [
        "/fonts/Soehne-Buch.woff2",
        "/icons/favicon-96x96.png",
        "/icons/favicon.svg",
        "/favicon.ico",
      ]
    ) {
      expect(cacheControl(path)).toBe("public, max-age=2592000");
    }
  });

  it("keeps the web manifest and security.txt for a day", () => {
    expect(cacheControl("/site.webmanifest")).toBe("public, max-age=86400");
    expect(cacheControl("/.well-known/security.txt")).toBe(
      "public, max-age=86400",
    );
  });

  it("revalidates pages, the 404 page and everything else", () => {
    for (const path of ["/", "/finalize.html", "/app.css", "/robots.txt"]) {
      expect(cacheControl(path)).toBe("no-cache");
    }
    expect(cacheControl("/app-00000000.css", 404)).toBe("no-cache");
  });
});

describe("the security headers", () => {
  it("allow scripts from the site's own files only, and nothing inline", () => {
    expect(CSP_DIRECTIVES).toContain("script-src 'self'");
    expect(SECURITY_HEADERS["Content-Security-Policy"]).not.toMatch(
      /unsafe-|sha256-|nonce-/,
    );
  });

  it("send no referrer and ask for HSTS preload", () => {
    expect(SECURITY_HEADERS["Referrer-Policy"]).toBe("no-referrer");
    expect(SECURITY_HEADERS["Strict-Transport-Security"]).toBe(
      "max-age=63072000; includeSubDomains; preload",
    );
  });
});

describe("DISABLED_FEATURES", () => {
  it("lists each feature once, in the header's own syntax", () => {
    expect(new Set(DISABLED_FEATURES).size).toBe(DISABLED_FEATURES.length);
    for (const feature of DISABLED_FEATURES) {
      expect(feature).toMatch(/^[a-z]+(-[a-z]+)*$/);
    }
  });

  it("leaves out the features Chrome does not recognise", () => {
    for (
      const feature of [
        "interest-cohort",
        "otp-credentials",
        "attribution-reporting",
        "join-ad-interest-group",
        "run-ad-auction",
        "private-aggregation",
        "shared-storage",
        "shared-storage-select-url",
      ]
    ) {
      expect(DISABLED_FEATURES).not.toContain(feature);
    }
  });

  it("does not also disable a feature the pages use", () => {
    for (const feature of SELF_FEATURES) {
      expect(DISABLED_FEATURES).not.toContain(feature);
    }
  });
});
