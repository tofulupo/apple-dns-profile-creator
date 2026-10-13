// Tauri's isolation hook ("pattern" in src-tauri/tauri.conf.json): a call that
// isn't in COMMANDS, with arguments of that shape, is dropped before it reaches
// Rust, and the page's call never settles. Rust still checks every call.

/** Rust's limit for a profile, MAX_PROFILE_BYTES in src-tauri/src/opened.rs. */
const MAX_PROFILE_BYTES = 5 * 1024 * 1024;

/** The names in src/ui/desktop.ts; a test checks both. */
export const EVENTS = [
  "profiles-opened",
  "save-requested",
  "share-requested",
  "appearance-chosen",
  "card-menu-chosen",
  "motion-chosen",
];
const APPEARANCES = ["system", "light", "dark"];
const MOTIONS = ["system", "reduce", "full"];

const text = (max) => (value) =>
  typeof value === "string" && value.length <= max;
const flag = (value) => typeof value === "boolean";
const oneOf = (values) => (value) => values.includes(value);
const orNull = (check) => (value) => value === null || check(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;
const finite = (value) => typeof value === "number" && Number.isFinite(value);
const byte = (value) => Number.isInteger(value) && value >= 0 && value <= 255;
const bytes = (max) => (value) =>
  Array.isArray(value) && value.length <= max && value.every(byte);
const rgb = (value) =>
  Array.isArray(value) && value.length === 3 && value.every(byte);
const shaped = (shape) => (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value) &&
  sameKeys(value, shape) &&
  Object.entries(shape).every(([key, check]) => check(value[key]));

function sameKeys(value, shape) {
  const keys = Object.keys(value);
  return keys.length === Object.keys(shape).length &&
    keys.every((key) => Object.hasOwn(shape, key));
}

const FILENAME = text(255);
const XML = text(MAX_PROFILE_BYTES);
const MESSAGE = text(10_000);
const IDENTITY = orNull(text(200));

/**
 * The commands in `generate_handler!` in src-tauri/src/lib.rs, and the plugin
 * calls the capabilities allow (src-tauri/capabilities/); a test checks both.
 * Argument names in camelCase, as src/ui/desktop.ts sends them.
 */
export const COMMANDS = {
  page_ready: { background: orNull(rgb) },
  list_signing_identities: {},
  save_profile: { filename: FILENAME, xml: XML, signWith: IDENTITY },
  share_profile: {
    filename: FILENAME,
    xml: XML,
    signWith: IDENTITY,
    anchor: shaped({ x: finite, y: finite, width: finite, height: finite }),
  },
  take_opened_profile: {},
  open_dropped_profile: { name: FILENAME, bytes: bytes(MAX_PROFILE_BYTES) },
  set_motion: { motion: oneOf(MOTIONS) },
  forget_on_quit: {},
  set_forget_on_quit: { forget: flag },
  ask: { message: MESSAGE },
  tell: { message: MESSAGE },
  set_save_action: { label: text(100), enabled: flag },
  set_share_enabled: { enabled: flag },
  set_appearance: { appearance: oneOf(APPEARANCES) },
  show_card_menu: { fix: flag },
  "plugin:event|listen": {
    event: oneOf(EVENTS),
    target: shaped({ kind: oneOf(["Any"]) }),
    handler: count,
  },
  "plugin:window|start_dragging": {},
  "plugin:window|internal_toggle_maximize": {},
};

/** Whether a call from a page may go on to Rust. */
export function allowed(call) {
  if (typeof call !== "object" || call === null) return false;
  const shape = Object.hasOwn(COMMANDS, call.cmd)
    ? COMMANDS[call.cmd]
    : undefined;
  return shape !== undefined && shaped(shape)(call.payload);
}

if ("document" in globalThis) {
  globalThis.__TAURI_ISOLATION_HOOK__ = (call) => {
    if (!allowed(call)) throw new Error("Dropped a call the app doesn't make");
    return call;
  };
}
