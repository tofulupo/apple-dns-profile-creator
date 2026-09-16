/**
 * Public surface of the pure core.
 */

export { collectServerAddresses } from "./addresses.ts";
export { buildDnsSettings } from "./dnssettings.ts";
export { buildOnDemandRules } from "./ondemand.ts";
export {
  extractPlistXml,
  parseProfile,
  parseProfileXml,
  ProfileImportError,
} from "./import.ts";
export {
  asArray,
  asDict,
  asString,
  asStringArray,
  buildPlist,
  isPlistDict,
  parsePlist,
  type PlistDict,
  PlistParseError,
  type PlistValue,
} from "./plist.ts";
export {
  buildProfile,
  buildProfileXml,
  DEFAULT_IDENTIFIER_PREFIX,
} from "./profile.ts";
export { randomUuid, uuidFromBytes } from "./uuid.ts";
export type {
  DnsConfig,
  DnsProtocol,
  ProfileOptions,
  UuidFactory,
} from "./types.ts";
export {
  IPV4_PATTERN,
  IPV6_PATTERN,
  isIPv4,
  isIPv6,
  parseList,
} from "./validate.ts";
export { parseXml, type XmlElement, XmlParseError } from "./xml.ts";
