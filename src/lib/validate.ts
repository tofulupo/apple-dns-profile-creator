import type { DnsConfig, DnsProtocol } from "./types.ts";

/** Dotted-quad IPv4, without leading zeros (`010` reads as octal to some). */
export const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)(?:\.(?!$)|$)){4}$/;

/**
 * IPv6 in any textual form, including `::` compression and IPv4-mapped
 * addresses. Zone indices (`fe80::1%en0`) are refused.
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

export type DohUrl = string & { readonly [brand]: "DohUrl" };

/** RFC 8484's URI template ending: `{?dns}`, or `{&dns}` after a query. */
const TEMPLATE_RE = /\{([?&])([^}]*)\}$/;

/**
 * RFC 8484: https, a host, no credentials or fragment, optionally ending in
 * `{?dns}` (`{&dns}` after a query), and never a `dns` parameter of its own.
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

export function serverError(
  protocol: DnsProtocol,
  server: string,
): string | null {
  if (server === "") return "A server address is required.";

  if (protocol === "HTTPS") {
    // Refuses `https:/host`, `https:///host`, backslashes and spaces, which
    // the URL parser repairs but RFC 3986 does not allow.
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
 * Captures the host after a `tls://`, `https://` or `http://` prefix. 853 is
 * the default DoT port.
 */
export function stripDotScheme(server: string): string {
  const match = /^\s*(?:tls|https?):\/\/([^/?#]*)/i.exec(server);
  if (match === null) return server;
  return (match[1] ?? "").replace(/:853$/, "");
}

/** A scheme at the start, even one missing a slash (`https:/`). */
const TYPED_SCHEME = /^(?:https?|tls):\/*/i;

export function withHttpsScheme(server: string): string {
  return "https://" + server.trim().replace(TYPED_SCHEME, "");
}

export function withDnsQueryPath(server: string): string {
  const trimmed = server.trim();
  // RFC 8484's `{?dns}` template has to stay last.
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

export function parseLines(value: string): string[] {
  return value
    .split(/\r?\n/)
    .filter((entry) => entry.trim() !== "");
}

/** 802.11 limits an SSID to 32 bytes, which is fewer characters in UTF-8. */
export const MAX_SSID_BYTES = 32;

const utf8 = new TextEncoder();

export type CheckedField =
  | "name"
  | "serverUrl"
  | "serverAddresses"
  | "excludedWifi";

export type ConfigProblems = Readonly<Partial<Record<CheckedField, string>>>;

function quoteList(values: readonly string[]): string {
  return values.map((value) => `“${value}”`).join(", ");
}

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
