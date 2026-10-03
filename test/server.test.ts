/**
 * The website's server (scripts/server.ts): the files as built, with the
 * caching and security headers the static deployment could not send.
 */
import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join } from "@std/path";

import {
  cacheControl,
  contentSecurityPolicy,
  createHandler,
  DISABLED_FEATURES,
  SELF_FEATURES,
} from "../scripts/server.ts";

const THEME = 'document.documentElement.dataset.theme="dark";';
const PAGE = "console.log(1);";
const HTML = `<!doctype html><html><head>
<script type="application/ld+json">{"@type":"WebApplication"}</script>
<link rel="stylesheet" href="./app-0123abcd.css">
<script>${THEME}</script></head><body><script>${PAGE}</script></body></html>`;

async function hash(code: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(code),
  );
  return `'sha256-${btoa(String.fromCharCode(...new Uint8Array(digest)))}'`;
}

describe("cacheControl", () => {
  it("keeps the fingerprinted stylesheet for good", () => {
    expect(cacheControl("/app-6a0f56fb.css")).toBe(
      "public, max-age=31536000, immutable",
    );
  });

  it("keeps fonts for a year and icons for a week, without immutable", () => {
    expect(cacheControl("/fonts/Geist-Latin.woff2")).toBe(
      "public, max-age=31536000",
    );
    expect(cacheControl("/icons/favicon.ico")).toBe("public, max-age=604800");
  });

  it("revalidates pages and everything else", () => {
    for (const path of ["/", "/finalize.html", "/app.css", "/robots.txt"]) {
      expect(cacheControl(path)).toBe("no-cache");
    }
  });
});

describe("contentSecurityPolicy", () => {
  it("allows exactly the page's inline scripts, by hash", async () => {
    const csp = await contentSecurityPolicy(HTML);
    expect(csp).toContain(
      `script-src ${await hash(THEME)} ${await hash(PAGE)};`,
    );
    expect(csp).toContain("default-src 'none'");
    expect(csp).toContain("frame-ancestors 'none'");
  });

  // Lighthouse fetches them from inside the page, under its policy.
  it("lets the page fetch robots.txt and llms.txt from its own origin", async () => {
    expect(await contentSecurityPolicy(HTML)).toContain("connect-src 'self'");
  });

  it("allows no script where the page has none", async () => {
    expect(await contentSecurityPolicy("<p>hi</p>")).toContain(
      "script-src 'none';",
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

  // Unknown to Chrome, which then warns in the console.
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

describe("createHandler", () => {
  let root = "";
  let handler: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    root = await Deno.makeTempDir();
    await Deno.writeTextFile(join(root, "index.html"), HTML);
    await Deno.writeTextFile(join(root, "app-0123abcd.css"), "p{color:red}");
    handler = createHandler(root);
  });

  afterAll(async () => {
    await Deno.remove(root, { recursive: true });
  });

  const get = (path: string) =>
    handler(new Request(`https://example.test${path}`));

  it("serves the start page with its policy and security headers", async () => {
    const response = await get("/");
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(HTML);
    expect(response.headers.get("Content-Security-Policy")).toBe(
      await contentSecurityPolicy(HTML),
    );
    expect(response.headers.get("Cache-Control")).toBe("no-cache");
    expect(response.headers.get("Strict-Transport-Security")).toContain(
      "max-age=",
    );
    expect(response.headers.get("Cross-Origin-Opener-Policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Cross-Origin-Embedder-Policy")).toBe(
      "require-corp",
    );
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "same-origin",
    );
    expect(response.headers.get("Permissions-Policy")).toBe(
      [
        ...DISABLED_FEATURES.map((feature) => `${feature}=()`),
        ...SELF_FEATURES.map((feature) => `${feature}=(self)`),
      ].join(", "),
    );
    // The profile page's Share button.
    expect(response.headers.get("Permissions-Policy")).toContain(
      "web-share=(self)",
    );
  });

  it("serves the stylesheet as immutable, without a page policy", async () => {
    const response = await get("/app-0123abcd.css");
    expect(await response.text()).toBe("p{color:red}");
    expect(response.headers.get("Cache-Control")).toContain("immutable");
    expect(response.headers.get("Content-Security-Policy")).toBeNull();
    expect(response.headers.get("Cross-Origin-Resource-Policy")).toBe(
      "same-origin",
    );
  });

  it("answers a repeat visit with 304, still with security headers", async () => {
    const first = await get("/");
    await first.body?.cancel();
    const response = await handler(
      new Request("https://example.test/", {
        headers: { "If-None-Match": first.headers.get("ETag")! },
      }),
    );
    expect(response.status).toBe(304);
    expect(response.headers.get("X-Frame-Options")).toBe("DENY");
    expect(response.headers.get("Permissions-Policy")).toContain("camera=()");
  });

  it("does not cache a missing file", async () => {
    const response = await get("/missing.html");
    await response.body?.cancel();
    expect(response.status).toBe(404);
    expect(response.headers.get("Cache-Control")).toBeNull();
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
  });
});
