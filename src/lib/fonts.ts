import {
  asArray,
  asDict,
  asString,
  parsePlist,
  type PlistDict,
  type PlistValue,
} from "./plist.ts";

const FONT_PAYLOAD_TYPE = "com.apple.font";

// The same rules as `check` in src-tauri/src/profile.rs, which checks again
// before saving or signing, with its messages for the fonts themselves.
// Change both together.
export const MIXED =
  "The profile holds fonts and other settings, so it can't be signed here.";
export const NOT_A_FONT =
  "A font in the profile is not a TrueType or OpenType font, so it was not saved.";
export const COLLECTION =
  "A font in the profile is a collection (.ttc or .otc), which Apple devices don't install.";
export const WEB_FONT =
  "A font in the profile is a web font (WOFF), which Apple devices don't install.";
export const UNIDENTIFIED =
  "The font profile or one of its fonts has no identifier, UUID or version.";

export type FontCheck =
  | { readonly valid: true; readonly fonts: number }
  | { readonly valid: false; readonly error: string };

function identified(dict: PlistDict): boolean {
  return (asString(dict["PayloadIdentifier"]) ?? "") !== "" &&
    (asString(dict["PayloadUUID"]) ?? "") !== "" &&
    typeof dict["PayloadVersion"] === "number";
}

function tag(font: Uint8Array): string {
  return String.fromCharCode(...font.subarray(0, 4));
}

function fontError(payload: PlistDict): string | undefined {
  if (!identified(payload)) return UNIDENTIFIED;
  const font = payload["Font"];
  if (!(font instanceof Uint8Array) || font.length < 4) return NOT_A_FONT;
  switch (tag(font)) {
    case "\0\u0001\0\0":
    case "true":
    case "OTTO":
      return undefined;
    case "ttcf":
      return COLLECTION;
    case "wOFF":
    case "wOF2":
      return WEB_FONT;
    default:
      return NOT_A_FONT;
  }
}

/**
 * The profile as fonts by Apple's rules, or undefined when it holds no font
 * payload at all.
 */
export function checkFontProfile(xml: string): FontCheck | undefined {
  let root: PlistValue;
  try {
    root = parsePlist(xml);
  } catch {
    return undefined;
  }
  const profile = asDict(root);
  const payloads = (asArray(profile?.["PayloadContent"]) ?? [])
    .map((entry) => asDict(entry));
  const fonts = payloads.filter((payload) =>
    asString(payload?.["PayloadType"]) === FONT_PAYLOAD_TYPE
  );
  if (profile === undefined || fonts.length === 0) return undefined;
  if (fonts.length !== payloads.length) return { valid: false, error: MIXED };
  if (
    asString(profile["PayloadType"]) !== "Configuration" || !identified(profile)
  ) {
    return { valid: false, error: UNIDENTIFIED };
  }
  for (const font of fonts) {
    const error = font === undefined ? NOT_A_FONT : fontError(font);
    if (error !== undefined) return { valid: false, error };
  }
  return { valid: true, fonts: fonts.length };
}
