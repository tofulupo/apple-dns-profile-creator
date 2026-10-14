/**
 * The website's response headers, as the server sends them. nginx in the
 * Ansible repo (`sites/mobileconfig.io/nginx/`) follows this file,
 * `deno task check:live` checks the live site against it, and
 * `scripts/server.ts` sends the same locally.
 */

const DAY = 60 * 60 * 24;
const YEAR = 365 * DAY;

/**
 * Names from the W3C Permissions Policy registry. Chromium builds without a
 * feature (Helium leaves out Web Bluetooth and Web Share) warn about its name
 * in the console; nothing breaks. Chrome's retired advertising APIs (FLoC's
 * interest-cohort, Protected Audience, Shared Storage, Attribution Reporting,
 * Private Aggregation) and otp-credentials are left out, as Chrome warns
 * about them too.
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

/**
 * Scripts only from the site's own files: the build writes them as
 * app-<hash>.js and inlines none. `data:` images for the inline SVG flags.
 * connect-src 'self' is for Lighthouse, which reads robots.txt and llms.txt.
 */
export const CSP_DIRECTIVES: readonly string[] = [
  "default-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
  "img-src 'self' data:",
  "font-src 'self'",
  "style-src 'self'",
  "script-src 'self'",
  "manifest-src 'self'",
  "connect-src 'self'",
  "require-trusted-types-for 'script'",
  "trusted-types 'none'",
];

/** On every response, error pages included. */
export const SECURITY_HEADERS: Readonly<Record<string, string>> = {
  "Content-Security-Policy": CSP_DIRECTIVES.join("; "),
  "Strict-Transport-Security": `max-age=${
    2 * YEAR
  }; includeSubDomains; preload`,
  "Cross-Origin-Opener-Policy": "same-origin",
  "Cross-Origin-Embedder-Policy": "require-corp",
  "Cross-Origin-Resource-Policy": "same-origin",
  "X-Frame-Options": "DENY",
  "X-Content-Type-Options": "nosniff",
  "X-Permitted-Cross-Domain-Policies": "none",
  "Referrer-Policy": "no-referrer",
  "Permissions-Policy": [
    ...DISABLED_FEATURES.map((feature) => `${feature}=()`),
    ...SELF_FEATURES.map((feature) => `${feature}=(self)`),
  ].join(", "),
};

/** iOS and macOS offer to install a profile served with this type. */
export const PROFILE_CONTENT_TYPE = "application/x-apple-aspen-config";

/** Sent by nginx on top of the expected headers, and allowed. */
export const EXTRA_HEADERS: readonly string[] = ["Alt-Svc", "QUIC-Status"];

/**
 * The stylesheet's and scripts' names are a hash of their content
 * (scripts/build.ts). Fonts and icons keep their names, so a changed one
 * needs a new name or visitors keep the old one for up to 30 days.
 */
export function cacheControl(pathname: string, status = 200): string {
  if (status === 404) return "no-cache";
  if (/^\/app-[0-9a-f]{8,}\.(?:css|js)$/i.test(pathname)) {
    return `public, max-age=${YEAR}, immutable`;
  }
  if (/\.(?:woff2|svg|png|ico)$/i.test(pathname)) {
    return `public, max-age=${30 * DAY}`;
  }
  if (
    pathname === "/site.webmanifest" ||
    pathname === "/.well-known/security.txt"
  ) {
    return `public, max-age=${DAY}`;
  }
  return "no-cache";
}
