/**
 * Resolver address handling.
 */

import { isIPv4, isIPv6 } from "./validate.ts";

export function collectServerAddresses(
  addresses: readonly string[],
): string[] {
  return addresses.filter((address) => isIPv4(address) || isIPv6(address));
}
