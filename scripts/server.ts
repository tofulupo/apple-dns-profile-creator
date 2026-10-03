#!/usr/bin/env -S deno run --allow-read --allow-net
import { serveDir } from "@std/http/file-server";
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const DIST = join(resolve(dirname(fromFileUrl(import.meta.url)), ".."), "dist");

const YEAR = 60 * 60 * 24 * 365;
const WEEK = 60 * 60 * 24 * 7;

/**
 * The stylesheet's name is a hash of its content (scripts/build.ts). The
 * fonts are not fingerprinted: a changed font needs a new file name, or
 * returning visitors keep the old one for up to a year.
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
 * Only names Chrome knows: it warns about any other in the console, so its
 * retired advertising APIs (FLoC's interest-cohort, Protected Audience, Shared
 * Storage, Attribution Reporting, Private Aggregation) and otp-credentials
 * are left out.
 */
export const DISABLED_FEATURES: readonly string[] = [
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
  "payment",
  "publickey-credentials-get",
  "publickey-credentials-create",
  "identity-credentials-get",
  "browsing-topics",
  "private-state-token-issuance",
  "private-state-token-redemption",
  "clipboard-read",
  "clipboard-write",
  "fullscreen",
  "picture-in-picture",
  "autoplay",
  "encrypted-media",
  "gamepad",
  "sync-xhr",
  "unload",
];

/** The Profile page's Share button needs web-share. */
export const SELF_FEATURES: readonly string[] = ["web-share"];

const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Strict-Transport-Security": `max-age=${2 * YEAR}; includeSubDomains`,
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": [
    ...DISABLED_FEATURES.map((feature) => `${feature}=()`),
    ...SELF_FEATURES.map((feature) => `${feature}=(self)`),
  ].join(", "),
};

async function sha256(text: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(text),
  );
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)));
  return `'sha256-${base64}'`;
}

/** connect-src 'self' is for Lighthouse, which reads robots.txt and llms.txt. */
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
