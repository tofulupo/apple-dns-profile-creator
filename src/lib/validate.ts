/**
 * Server and resolver address validation.
 */

import type { DnsConfig, DnsProtocol } from "./types.ts";

/**
 * Dotted-quad IPv4. Leading zeros are refused: `010.0.0.1` is 8.0.0.1 to
 * parsers that read them as octal and 10.0.0.1 to the rest.
 */
export const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?!$)|$)){4}$/;

/**
 * IPv6 in any of its textual forms, including `::` compression and
 * IPv4-mapped addresses. Zone indices (`fe80::1%en0`) are refused: they name
 * an interface of one machine, which means nothing inside a profile.
 */
export const IPV6_PATTERN =
  /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;

export function isIPv4(value: string): boolean {
  return IPV4_PATTERN.test(value);
}

export function isIPv6(value: string): boolean {
  return IPV6_PATTERN.test(value);
}

/** A DNS name, or an IPv4 address written the same way. No port, no path. */
const HOST_NAME_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.?$/i;

declare const brand: unique symbol;

/** A string `isDohUrl` has accepted. */
export type DohUrl = string & { readonly [brand]: "DohUrl" };

/** RFC 8484's URI template ending: `{?dns}`, or `{&dns}` after a query. */
const TEMPLATE_RE = /\{([?&])([^}]*)\}$/;

/**
 * Whether `input` is a DoH server URL as RFC 8484 defines it: https, a host,
 * no credentials or fragment, optionally ending in the `{?dns}` template
 * (`{&dns}` when it already has a query), and never a `dns` parameter of its
 * own. Judges the URL as parsed; `serverError` adds the checks on how it is
 * written.
 */
export function isDohUrl(input: string): input is DohUrl {
  const match = TEMPLATE_RE.exec(input);
  if (match ? match[2] !== "dns" : /[{}]/.test(input)) return false;

  const raw = match ? input.slice(0, -match[0].length) : input;
  if (raw.includes("#")) return false;

  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return false;
  }

  return (
    url.protocol === "https:" &&
    url.hostname !== "" &&
    url.username === "" &&
    url.password === "" &&
    !url.searchParams.has("dns") &&
    (!match || (match[1] === "?") !== (url.search !== ""))
  );
}

/**
 * Why `server` cannot be used with `protocol`, or null when it can. The
 * form reports the message on submit, and shows a check mark while it is null.
 */
export function serverError(
  protocol: DnsProtocol,
  server: string,
): string | null {
  if (server === "") return "A server address is required.";

  if (protocol === "HTTPS") {
    // Checked as written as well as parsed. The URL parser (WHATWG) repairs
    // `https:/host`, `https:///host`, backslashes and spaces into a valid
    // URL, which `isDohUrl` then accepts; RFC 3986 allows none of them in an
    // https URI, and the profile carries the text exactly as typed.
    if (
      !/^https:\/\/[^/\\]/i.test(server) || /[\s\\]/.test(server) ||
      !isDohUrl(server)
    ) {
      return "A DoH server must be an https:// URL.";
    }
    return null;
  }

  if (server.includes(":")) {
    return "Custom ports are not supported for DoT. Remove the “:” part.";
  }
  if (!HOST_NAME_PATTERN.test(server)) {
    return "A DoT server must be a host name such as dot.example.com.";
  }
  return null;
}

/**
 * `server` without a `tls://`, `https://` or `http://` in front, for the DoT
 * field: provider docs often write DoT servers as `tls://dns.example.com`,
 * while a profile takes the bare host name. Drops what follows the host too,
 * and the default DoT port 853, which would only fail the check. Anything
 * without such a scheme comes back as it was.
 */
export function stripDotScheme(server: string): string {
  const match = /^\s*(?:tls|https?):\/\/([^/?#]*)/i.exec(server);
  if (match === null) return server;
  return (match[1] ?? "").replace(/:853$/, "");
}

/**
 * A scheme at the start of a typed or pasted server, even one missing a
 * slash (`https:/`), so the quick inserts can replace it rather than stack
 * a second one in front.
 */
const TYPED_SCHEME = /^(?:https?|tls):\/*/i;

/** `server` with `https://` in front, replacing any scheme it had. */
export function withHttpsScheme(server: string): string {
  return "https://" + server.trim().replace(TYPED_SCHEME, "");
}

/**
 * `server` ending in `/dns-query`, the path most DoH servers use. Unchanged
 * when it already does, or when there is no host yet to put the path after:
 * appending to a bare `https://` would only make `https:///dns-query`.
 */
export function withDnsQueryPath(server: string): string {
  const trimmed = server.trim();
  // A template such as `{?dns}` has to stay last, so the path cannot follow.
  if (/\/dns-query$/i.test(trimmed) || TEMPLATE_RE.test(trimmed)) {
    return server;
  }
  const host = trimmed.replace(TYPED_SCHEME, "").replace(/\/+$/, "");
  if (host === "") return server;
  return trimmed.replace(/\/+$/, "") + "/dns-query";
}

export function parseList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}

/**
 * One entry per line, kept exactly as typed. For Wi-Fi network names, which
 * may contain commas and begin or end with spaces, so neither `parseList`'s
 * comma split nor its trimming is safe. Blank lines are dropped.
 */
export function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .filter((entry) => entry.trim() !== "");
}

/** 802.11 limits an SSID to 32 bytes, which is fewer characters in UTF-8. */
export const MAX_SSID_BYTES = 32;

const utf8 = new TextEncoder();

/** The fields `configProblems` can object to. */
export type CheckedField =
  | "name"
  | "serverUrl"
  | "serverAddresses"
  | "excludedWifi";

export type ConfigProblems = Readonly<Partial<Record<CheckedField, string>>>;

function quoteList(values: readonly string[]): string {
  return values.map((value) => `“${value}”`).join(", ");
}

/**
 * Why `config` would produce a broken or misleading profile, per field; empty
 * when it is fine. The single source of these rules: the form reports them on
 * its fields, the profile page on imported and stored entries.
 */
export function configProblems(config: DnsConfig): ConfigProblems {
  const problems: Partial<Record<CheckedField, string>> = {};

  if (config.name.trim() === "") {
    problems.name = "Give the provider a name.";
  }

  const server = serverError(config.protocol, config.serverUrl);
  if (server !== null) problems.serverUrl = server;

  const badAddresses = config.serverAddresses.filter(
    (address) => !isIPv4(address) && !isIPv6(address),
  );
  if (badAddresses.length > 0) {
    problems.serverAddresses = `Not valid IP addresses: ${
      badAddresses.join(", ")
    }`;
  }

  const longSsids = config.excludedWifi.filter((ssid) =>
    utf8.encode(ssid).length > MAX_SSID_BYTES
  );
  if (longSsids.length > 0) {
    problems.excludedWifi =
      `Wi-Fi network names are at most ${MAX_SSID_BYTES} bytes: ${
        quoteList(longSsids)
      }`;
  }

  return problems;
}

export function hasProblems(problems: ConfigProblems): boolean {
  return Object.keys(problems).length > 0;
}
