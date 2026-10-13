import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join } from "@std/path";

import {
  checkLive,
  CurlMissing,
  inlineScripts,
  linkedFiles,
  parseOptions,
  report,
  type Result,
  securityTxtProblems,
  SITE,
} from "../scripts/check_live.ts";
import { createHandler } from "../scripts/server.ts";

const PAGE = `<!doctype html><html><head>
<script type="application/ld+json">{"@type":"WebApplication"}</script>
<link rel="stylesheet" href="./app-0123abcd.css">
<link rel="preload" href="fonts/Font.woff2" as="font"
  type="font/woff2" crossorigin>
<link rel="icon" type="image/svg+xml" href="icons/favicon.svg" />
<link rel="manifest" href="site.webmanifest" />
<script src="./app-1b2c3d4e.js"></script>
</head><body></body></html>`;

async function site(root: string): Promise<void> {
  const write = (path: string, text: string) =>
    Deno.writeTextFile(join(root, path), text);
  await Deno.mkdir(join(root, "fonts"));
  await Deno.mkdir(join(root, "icons"));
  await write("index.html", PAGE);
  await write("finalize.html", PAGE);
  await write("404.html", "<!doctype html><h1>Page not found</h1>");
  await write("app-0123abcd.css", "p{color:red}".repeat(200));
  await write("app-1b2c3d4e.js", "console.log(1);".repeat(200));
  await write("fonts/Font.woff2", "wOF2");
  await write("icons/favicon.svg", "<svg></svg>");
  await write("site.webmanifest", "{}");
  await write("build.txt", "commit: 0123456789abcdef\nclean: yes\n");
  await Deno.mkdir(join(root, ".well-known"));
  await write(
    ".well-known/security.txt",
    "Contact: mailto:security@example.test\nExpires: 2027-10-06T00:00:00Z\n",
  );
}

const NOW = new Date("2026-10-13T12:00:00Z");

function serve(
  root: string,
  change: (headers: Headers) => void = () => {},
): Deno.HttpServer<Deno.NetAddr> {
  const handler = createHandler(root);
  return Deno.serve(
    {
      hostname: "127.0.0.1",
      port: 0,
      automaticCompression: true,
      onListen: () => {},
    },
    async (request) => {
      const response = await handler(request);
      change(response.headers);
      return response;
    },
  );
}

const failures = (results: readonly Result[]) =>
  results.filter((result) => result.outcome === "fail");

describe("check:live against the local server", () => {
  let root = "";

  beforeAll(async () => {
    root = await Deno.makeTempDir();
    await site(root);
  });

  afterAll(async () => {
    await Deno.remove(root, { recursive: true });
  });

  it("passes every check that applies to an http:// URL", async () => {
    const server = serve(root);
    try {
      const url = `http://127.0.0.1:${server.addr.port}/`;
      const results = await checkLive({ url, commit: "0123456", now: NOW });
      expect(failures(results)).toEqual([]);
      expect(results.map((result) => result.name)).toEqual([
        "page /",
        "page /finalize.html",
        "file /app-0123abcd.css",
        "file /app-1b2c3d4e.js",
        "file /fonts/Font.woff2",
        "file /site.webmanifest",
        "file /icons/favicon.svg",
        "unknown path 404",
        "POST 405",
        "build.txt, commit 0123456789abcdef",
        "security.txt, expires 2027-10-06 (357 days)",
        "redirects",
        "TLS 1.3 only",
        "Deno Deploy redirect",
      ]);
      expect(results.slice(-3).map((result) => result.outcome))
        .toEqual(["skip", "skip", "skip"]);
    } finally {
      await server.shutdown();
    }
  });

  it("fails, naming the header, when one is changed", async () => {
    const server = serve(root, (headers) => {
      headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
    });
    try {
      const results = await checkLive({
        url: `http://127.0.0.1:${server.addr.port}/`,
      });
      const failed = failures(results);
      expect(failed.length).toBeGreaterThan(0);
      for (const result of failed) {
        expect(result.detail).toContain(
          'Referrer-Policy: expected "no-referrer", got "strict-origin-when-cross-origin"',
        );
      }
      expect(report(failed)).toMatch(/^fail page \/: Referrer-Policy/);
    } finally {
      await server.shutdown();
    }
  });

  it("names a CSP directive that is missing or extra", async () => {
    const server = serve(root, (headers) => {
      headers.set(
        "Content-Security-Policy",
        (headers.get("Content-Security-Policy") ?? "")
          .replace("script-src 'self'", "script-src 'self' 'unsafe-inline'"),
      );
    });
    try {
      const results = await checkLive({
        url: `http://127.0.0.1:${server.addr.port}/`,
      });
      expect(failures(results)[0]?.detail).toBe(
        `CSP lacks "script-src 'self'"; CSP has extra "script-src 'self' 'unsafe-inline'"`,
      );
    } finally {
      await server.shutdown();
    }
  });

  it("fails on another commit than expected", async () => {
    const server = serve(root);
    try {
      const results = await checkLive({
        url: `http://127.0.0.1:${server.addr.port}/`,
        commit: "fedcba9",
        now: NOW,
      });
      expect(failures(results).map((result) => result.detail)).toEqual([
        "expected commit fedcba9",
      ]);
    } finally {
      await server.shutdown();
    }
  });

  it("stops with a clear message when curl is missing", async () => {
    await expect(
      checkLive({ url: "http://127.0.0.1:9/", curl: "curl-that-isnt-there" }),
    ).rejects.toThrow(CurlMissing);
    await expect(
      checkLive({ url: "http://127.0.0.1:9/", curl: "curl-that-isnt-there" }),
    ).rejects.toThrow("check:live makes every request with curl");
  });
});

describe("securityTxtProblems", () => {
  const URL = "https://example.test/.well-known/security.txt";
  const text = (expires: string, extra = "") =>
    `-----BEGIN PGP SIGNED MESSAGE-----\nHash: SHA512\n\n` +
    `Contact: mailto:security@example.test\nExpires: ${expires}\n${extra}` +
    `-----BEGIN PGP SIGNATURE-----\n`;

  it("accepts a file that runs for more than 30 days, signed or not", () => {
    expect(securityTxtProblems(text("2027-10-06T00:00:00Z"), URL, NOW))
      .toEqual({ problems: [], expires: new Date("2027-10-06T00:00:00Z") });
  });

  it("fails 30 days before it expires, and after", () => {
    expect(
      securityTxtProblems(text("2026-11-01T00:00:00Z"), URL, NOW).problems,
    ).toEqual([
      "expires in 18 days (2026-11-01T00:00:00Z), renew with `just security-txt`",
    ]);
    expect(
      securityTxtProblems(text("2026-10-01T00:00:00Z"), URL, NOW).problems,
    ).toEqual(["expired on 2026-10-01T00:00:00Z"]);
  });

  it("names a missing field, a bad date and a wrong Canonical", () => {
    expect(
      securityTxtProblems("Expires: 2027-01-01T00:00:00Z", URL, NOW).problems,
    )
      .toEqual(["no Contact"]);
    expect(securityTxtProblems("Contact: mailto:a@b.test", URL, NOW).problems)
      .toEqual(["no Expires"]);
    expect(securityTxtProblems(text("next year"), URL, NOW).problems)
      .toEqual(['Expires is not a date: "next year"']);
    expect(
      securityTxtProblems(
        text(
          "2027-10-06T00:00:00Z",
          "Canonical: https://other.test/security.txt\n",
        ),
        URL,
        NOW,
      ).problems,
    ).toEqual([`Canonical is not ${URL}`]);
  });
});

describe("reading a page", () => {
  it("finds the files a page links", () => {
    expect(linkedFiles(PAGE)).toEqual([
      "./app-0123abcd.css",
      "./app-1b2c3d4e.js",
      "fonts/Font.woff2",
      "site.webmanifest",
      "icons/favicon.svg",
    ]);
  });

  it("counts inline scripts, but not JSON-LD", () => {
    expect(inlineScripts(PAGE)).toBe(0);
    expect(inlineScripts(`${PAGE}<script>alert(1)</script>`)).toBe(1);
  });
});

describe("parseOptions", () => {
  it("checks mobileconfig.io with the Deno Deploy redirect by default", () => {
    expect(parseOptions([])).toEqual({ url: SITE, denoDeploy: true });
  });

  it("reads the address, commit and URL", () => {
    expect(
      parseOptions([
        "https://mobileconfig.io",
        "--ip",
        "82.221.100.205",
        "--commit",
        "abc1234",
        "--no-deno-deploy",
      ]),
    ).toEqual({
      url: SITE,
      ip: "82.221.100.205",
      commit: "abc1234",
      denoDeploy: false,
    });
  });

  it("refuses an unknown option", () => {
    expect(() => parseOptions(["--resolve"])).toThrow("unknown option");
  });
});
