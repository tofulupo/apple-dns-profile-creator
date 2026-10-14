import { afterAll, beforeAll, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join } from "@std/path";

import {
  cacheControl,
  PROFILE_CONTENT_TYPE,
  SECURITY_HEADERS,
} from "../scripts/headers.ts";
import { createHandler } from "../scripts/server.ts";

const HTML = `<!doctype html><html><head>
<link rel="stylesheet" href="./app-0123abcd.css"></head><body></body></html>`;
const NOT_FOUND =
  `<!doctype html><html><head></head><body><h1>Page not found</h1></body></html>`;

function expectHeaders(response: Response, path: string): void {
  for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
    expect({ path, name, value: response.headers.get(name) })
      .toEqual({ path, name, value });
  }
  expect(response.headers.get("Cache-Control"))
    .toBe(cacheControl(path, response.status));
}

describe("createHandler", () => {
  let root = "";
  let handler: (request: Request) => Promise<Response>;

  beforeAll(async () => {
    root = await Deno.makeTempDir();
    await Deno.writeTextFile(join(root, "index.html"), HTML);
    await Deno.writeTextFile(join(root, "404.html"), NOT_FOUND);
    await Deno.writeTextFile(join(root, "app-0123abcd.css"), "p{color:red}");
    await Deno.mkdir(join(root, "fonts"));
    await Deno.writeFile(join(root, "fonts", "Font.woff2"), new Uint8Array(8));
    await Deno.writeTextFile(join(root, "site.webmanifest"), "{}");
    await Deno.mkdir(join(root, "profiles"));
    await Deno.writeTextFile(
      join(root, "profiles", "quad9.mobileconfig"),
      "<plist/>",
    );
    handler = createHandler(root);
  });

  afterAll(async () => {
    await Deno.remove(root, { recursive: true });
  });

  const get = (path: string, init?: RequestInit) =>
    handler(new Request(`https://example.test${path}`, init));

  it("sends the headers in scripts/headers.ts with every file", async () => {
    for (
      const path of [
        "/",
        "/app-0123abcd.css",
        "/fonts/Font.woff2",
        "/site.webmanifest",
      ]
    ) {
      const response = await get(path);
      await response.body?.cancel();
      expect(response.status).toBe(200);
      expectHeaders(response, path);
    }
  });

  it("serves profiles as a type iOS and macOS offer to install", async () => {
    const path = "/profiles/quad9.mobileconfig";
    const response = await get(path);
    await response.body?.cancel();
    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe(PROFILE_CONTENT_TYPE);
    expectHeaders(response, path);
  });

  it("answers a missing path with the 404 page and the same headers", async () => {
    for (const path of ["/nope", "/a/b/c", "/app-00000000.css"]) {
      const response = await get(path);
      expect(response.status).toBe(404);
      expect(await response.text()).toBe(NOT_FOUND);
      expect(response.headers.get("Content-Type")).toBe(
        "text/html; charset=UTF-8",
      );
      expectHeaders(response, path);
    }
  });

  it("tells caches that every response depends on Accept-Encoding", async () => {
    for (const path of ["/", "/app-0123abcd.css", "/nope"]) {
      const response = await get(path);
      await response.body?.cancel();
      expect(response.headers.get("Vary")).toBe("Accept-Encoding");
    }
  });

  it("answers a repeat visit with 304, still with the headers", async () => {
    const first = await get("/");
    await first.body?.cancel();
    const response = await get("/", {
      headers: { "If-None-Match": first.headers.get("ETag")! },
    });
    expect(response.status).toBe(304);
    expectHeaders(response, "/");
  });

  it("answers anything but GET and HEAD with 405 and Allow", async () => {
    for (const method of ["POST", "PUT", "DELETE", "OPTIONS"]) {
      const response = await get("/", { method });
      expect(response.status).toBe(405);
      expect(response.headers.get("Allow")).toBe("GET, HEAD");
    }
  });
});
