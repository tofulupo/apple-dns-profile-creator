/**
 * Server and resolver address validation.
 */

import type { DnsProtocol } from "./types.ts";

/** https://regex101.com/r/ChFXjy/2 */
export const IPV4_PATTERN =
  /^(?:(?:25[0-5]|2[0-4]\d|1?\d{1,2})(?:\.(?!$)|$)){4}$/;

/**
 * IPv6 in any of its textual forms, including `::` compression, zone indices
 * and IPv4-mapped addresses.
 */
export const IPV6_PATTERN =
  /^(([0-9a-fA-F]{1,4}:){7,7}[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,7}:|([0-9a-fA-F]{1,4}:){1,6}:[0-9a-fA-F]{1,4}|([0-9a-fA-F]{1,4}:){1,5}(:[0-9a-fA-F]{1,4}){1,2}|([0-9a-fA-F]{1,4}:){1,4}(:[0-9a-fA-F]{1,4}){1,3}|([0-9a-fA-F]{1,4}:){1,3}(:[0-9a-fA-F]{1,4}){1,4}|([0-9a-fA-F]{1,4}:){1,2}(:[0-9a-fA-F]{1,4}){1,5}|[0-9a-fA-F]{1,4}:((:[0-9a-fA-F]{1,4}){1,6})|:((:[0-9a-fA-F]{1,4}){1,7}|:)|fe80:(:[0-9a-fA-F]{0,4}){0,4}%[0-9a-zA-Z]{1,}|::(ffff(:0{1,4}){0,1}:){0,1}((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])|([0-9a-fA-F]{1,4}:){1,4}:((25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9])\.){3,3}(25[0-5]|(2[0-4]|1{0,1}[0-9]){0,1}[0-9]))$/;

export function isIPv4(value: string): boolean {
  return IPV4_PATTERN.test(value);
}

export function isIPv6(value: string): boolean {
  return IPV6_PATTERN.test(value);
}

/** A DNS name, or an IPv4 address written the same way. No port, no path. */
const HOST_NAME_PATTERN = /^[a-z0-9-]+(?:\.[a-z0-9-]+)+\.?$/i;

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
    let url: URL;
    try {
      url = new URL(server);
    } catch {
      return "A DoH server must be an https:// URL.";
    }
    if (url.protocol !== "https:" || url.hostname === "" || /\s/.test(server)) {
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

export function parseList(value: string): string[] {
  return value
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
}
