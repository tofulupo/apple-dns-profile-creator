#!/usr/bin/env -S deno run --allow-read --allow-net
/**
 * The website from dist/ with the server's headers (scripts/headers.ts):
 * Deno Deploy's entrypoint (`deploy` in deno.json), and locally for the
 * browser tests, Lighthouse and screenshots.
 */
import { serveDir } from "@std/http/file-server";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

import {
  cacheControl,
  PROFILE_CONTENT_TYPE,
  SECURITY_HEADERS,
} from "./headers.ts";

const DIST = join(resolve(dirname(fromFileUrl(import.meta.url)), ".."), "dist");

/** The build's 404 page, as nginx serves it (`error_page 404 /404.html`). */
async function notFound(fsRoot: string, served: Response): Promise<Response> {
  let html: string;
  try {
    html = await Deno.readTextFile(join(fsRoot, "404.html"));
  } catch (error) {
    if (error instanceof Deno.errors.NotFound) return served;
    throw error;
  }
  await served.body?.cancel();
  return new Response(html, {
    status: 404,
    statusText: "Not Found",
    headers: { "Content-Type": "text/html; charset=UTF-8" },
  });
}

function methodNotAllowed(): Response {
  return new Response(null, {
    status: 405,
    statusText: "Method Not Allowed",
    headers: { Allow: "GET, HEAD" },
  });
}

export function createHandler(
  fsRoot: string,
): (request: Request) => Promise<Response> {
  return async (request) => {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed();
    }
    let served = await serveDir(request, {
      fsRoot,
      quiet: true,
      showDotfiles: true,
    });
    if (served.status === 404) served = await notFound(fsRoot, served);
    const { pathname } = new URL(request.url);
    const headers = new Headers(served.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      headers.set(name, value);
    }
    headers.set("Cache-Control", cacheControl(pathname, served.status));
    if (served.ok && pathname.endsWith(".mobileconfig")) {
      headers.set("Content-Type", PROFILE_CONTENT_TYPE);
    }
    // Deno.serve compresses only for clients that ask, and adds Vary only when
    // it does. Without Vary every time, an edge cache that stored the plain
    // copy for one client serves it to all.
    headers.set("Vary", "Accept-Encoding");
    return new Response(served.body, {
      status: served.status,
      statusText: served.statusText,
      headers,
    });
  };
}

if (import.meta.main) {
  Deno.serve({ automaticCompression: true }, createHandler(DIST));
}
