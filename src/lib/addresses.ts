/**
 * Resolver address handling.
 */

import { isIPv4, isIPv6 } from "./validate.ts";

export function collectServerAddresses(
  addresses: readonly string[],
): string[] {
  return addresses.filter((address) => isIPv4(address) || isIPv6(address));
}

/**
 * How many resolver addresses of each family a configuration keeps: the tool
 * page has two IPv4 and two IPv6 fields, and imports are cut down to match.
 */
export const MAX_ADDRESSES_PER_FAMILY = 2;

/** `addresses` cut down to what the tool page can hold, and what was cut. */
export interface LimitedAddresses {
  /** In their original order. */
  readonly kept: string[];
  /** Addresses beyond the first two of their family, and non-addresses. */
  readonly dropped: string[];
}

export function limitServerAddresses(
  addresses: readonly string[],
): LimitedAddresses {
  const kept: string[] = [];
  const dropped: string[] = [];
  let ipv4 = 0;
  let ipv6 = 0;
  for (const address of addresses) {
    if (isIPv4(address) && ipv4 < MAX_ADDRESSES_PER_FAMILY) {
      ipv4 += 1;
      kept.push(address);
    } else if (isIPv6(address) && ipv6 < MAX_ADDRESSES_PER_FAMILY) {
      ipv6 += 1;
      kept.push(address);
    } else {
      dropped.push(address);
    }
  }
  return { kept, dropped };
}

/** Resolver addresses sorted into the tool page's fields. */
export interface AddressSlots {
  readonly ipv4: string[];
  readonly ipv6: string[];
  /** What did not fit, as in `limitServerAddresses`. */
  readonly dropped: string[];
}

export function splitServerAddresses(
  addresses: readonly string[],
): AddressSlots {
  const { kept, dropped } = limitServerAddresses(addresses);
  return {
    ipv4: kept.filter(isIPv4),
    ipv6: kept.filter(isIPv6),
    dropped,
  };
}

/**
 * The order the tool page stores addresses in: IPv4 first, then IPv6, each
 * family in its own order. Clients try them in this order.
 */
export function orderServerAddresses(addresses: readonly string[]): string[] {
  const { ipv4, ipv6 } = splitServerAddresses(addresses);
  return [...ipv4, ...ipv6];
}
