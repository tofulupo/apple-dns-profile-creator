#!/usr/bin/env -S deno run --allow-read --allow-net
// The website's server on Deno Deploy: dist/ as built, plus the headers a
// static deployment cannot set (caching and security). Deno.serve compresses
// the responses itself (gzip or brotli, as the browser asks), once
// automaticCompression turns that on.
import { serveDir } from "@std/http/file-server";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const DIST = join(resolve(dirname(fromFileUrl(import.meta.url)), ".."), "dist");

const YEAR = 60 * 60 * 24 * 365;
const WEEK = 60 * 60 * 24 * 7;

/**
 * How long browsers may keep a file. The stylesheet's name is a hash of its
 * content (scripts/build.ts), so it never changes under the same URL. The
 * fonts are not fingerprinted: a changed font needs a new file name, or
 * returning visitors keep the old one for up to a year. Everything else is
 * revalidated on each visit, which the ETag makes a cheap 304.
 */
export function cacheControl(pathname: string): string {
  if (/^\/app-[0-9a-f]+\.css$/.test(pathname)) {
    return `public, max-age=${YEAR}, immutable`;
  }
  if (/^\/fonts\/[^/]+\.woff2$/.test(pathname)) {
    return `public, max-age=${YEAR}`;
  }
  if (pathname.startsWith("/icons/")) return `public, max-age=${WEEK}`;
  return "no-cache";
}

/**
 * Browser features the pages may use: none. Pasting addresses is a plain paste
 * event, downloads are blob: links and loading a file is a file input, none of
 * which the policy governs. The header has no "everything else", so each
 * feature is listed. Only names Chrome knows: it warns about any other in the
 * console, so its retired advertising APIs (FLoC's interest-cohort, Protected
 * Audience, Shared Storage, Attribution Reporting, Private Aggregation) and
 * otp-credentials, which desktop Chrome does not have, are left out.
 */
export const DISABLED_FEATURES: readonly string[] = [
  // Hardware and sensors.
  "camera",
  "microphone",
  "geolocation",
  "display-capture",
  "accelerometer",
  "gyroscope",
  "magnetometer",
  "usb",
  "serial",
  "hid",
  "bluetooth",
  "midi",
  "xr-spatial-tracking",
  "screen-wake-lock",
  "idle-detection",
  "local-fonts",
  "window-management",
  // Payments and credentials.
  "payment",
  "publickey-credentials-get",
  "publickey-credentials-create",
  "identity-credentials-get",
  // Chrome's advertising and tracking APIs.
  "browsing-topics",
  "private-state-token-issuance",
  "private-state-token-redemption",
  // Page behaviour. The clipboard pair only covers scripts reading and
  // writing it; the user's own copy and paste still work.
  "clipboard-read",
  "clipboard-write",
  "fullscreen",
  "picture-in-picture",
  "autoplay",
  "encrypted-media",
  "web-share",
  "gamepad",
  "sync-xhr",
  "unload",
];

/**
 * Sent with every response. The cross-origin pair: the pages load nothing
 * from another origin (the CSP allows only 'self' and data:), so they can
 * require every subresource to opt in, and no other site may embed the
 * site's files. Link previews fetch from a server, which neither governs.
 */
const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": `max-age=${2 * YEAR}; includeSubDomains`,
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": DISABLED_FEATURES.map((feature) => `${feature}=()`)
    .join(", "),
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return `'sha256-${base64}'`;
}

/**
 * The page's Content-Security-Policy. The pages' only scripts are inline (the
 * layout's theme script and the bundled page script, see inlineScript in
 * scripts/build.ts), so they are allowed by hash, read from the page itself
 * so a rebuild never leaves a stale one. JSON-LD is data, which CSP does not
 * govern. Icons and flags are data: URIs inside the stylesheet; downloads
 * are blob: links, which are navigations rather than fetches. The scripts
 * fetch nothing, but tools auditing the page do so from inside it, under its
 * policy: Lighthouse reads robots.txt and llms.txt that way, hence
 * connect-src 'self'. The scripts write no HTML, so Trusted Types can forbid
 * it outright.
 */
export async function contentSecurityPolicy(html: string): Promise<string> {
  const scripts = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)]
    .map((match) => match[1]!);
  const hashes = await Promise.all(scripts.map(sha256));
  return [
    "default-src 'none'",
    `script-src ${
      hashes.length > 0 ? [...new Set(hashes)].join(" ") : "'none'"
    }`,
    "style-src 'self'",
    "img-src 'self' data:",
    "font-src 'self'",
    "connect-src 'self'",
    "manifest-src 'self'",
    "base-uri 'none'",
    "form-action 'none'",
    "frame-ancestors 'none'",
    "require-trusted-types-for 'script'",
    "trusted-types 'none'",
  ].join("; ");
}

/** Serves `fsRoot` with the site's headers. */
export function createHandler(
  fsRoot: string,
): (request: Request) => Promise<Response> {
  return async (request) => {
    const served = await serveDir(request, { fsRoot, quiet: true });
    const { pathname } = new URL(request.url);
    const headers = new Headers(served.headers);
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      headers.set(name, value);
    }
    if (served.ok) headers.set("Cache-Control", cacheControl(pathname));

    const isHtml = headers.get("Content-Type")?.startsWith("text/html");
    if (!isHtml || served.body === null) {
      return new Response(served.body, {
        status: served.status,
        statusText: served.statusText,
        headers,
      });
    }

    const html = await served.text();
    headers.set("Content-Security-Policy", await contentSecurityPolicy(html));
    return new Response(html, {
      status: served.status,
      statusText: served.statusText,
      headers,
    });
  };
}

if (import.meta.main) {
  Deno.serve({ automaticCompression: true }, createHandler(DIST));
}
