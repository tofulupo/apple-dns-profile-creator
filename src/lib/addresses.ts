import { isIPv4, isIPv6 } from "./validate.ts";

export function collectServerAddresses(
  addresses: readonly string[],
): string[] {
  return addresses.filter((address) => isIPv4(address) || isIPv6(address));
}

/** The tool page has two IPv4 and two IPv6 fields. */
export const MAX_ADDRESSES_PER_FAMILY = 2;

export interface LimitedAddresses {
  readonly kept: string[];
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

export interface AddressSlots {
  readonly ipv4: string[];
  readonly ipv6: string[];
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

export function orderServerAddresses(addresses: readonly string[]): string[] {
  const { ipv4, ipv6 } = splitServerAddresses(addresses);
  return [...ipv4, ...ipv6];
}
