import type {
  Appearance,
  CardAction,
  DesktopBindings,
  OpenedProfile,
  SigningIdentity,
} from "../desktop/bindings.ts";

export type Invoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

export type Listen = (
  event: string,
  handler: (event: unknown) => void,
) => Promise<unknown>;

/** Injected by `withGlobalTauri` in src-tauri/tauri.conf.json. */
export interface TauriGlobal {
  readonly core: { readonly invoke: Invoke };
  readonly event: { readonly listen: Listen };
}

/** Must match `OPENED_EVENT` in src-tauri/src/opened.rs; a test checks both. */
export const OPENED_EVENT = "profiles-opened";
/** Must match `SAVE_EVENT` in src-tauri/src/menu.rs; a test checks both. */
export const SAVE_EVENT = "save-requested";
/** Must match `SHARE_EVENT` in src-tauri/src/menu.rs; a test checks both. */
export const SHARE_EVENT = "share-requested";
/** Must match `APPEARANCE_EVENT` in src-tauri/src/menu.rs; a test checks both. */
export const APPEARANCE_EVENT = "appearance-chosen";
/** Must match `CARD_MENU_EVENT` in src-tauri/src/menu.rs; a test checks both. */
export const CARD_MENU_EVENT = "card-menu-chosen";

const APPEARANCES: readonly unknown[] = [
  "system",
  "light",
  "dark",
] satisfies Appearance[];
const CARD_ACTIONS: readonly unknown[] = [
  "edit",
  "delete",
] satisfies CardAction[];

function payloadOf(event: unknown): unknown {
  return typeof event === "object" && event !== null && "payload" in event
    ? event.payload
    : undefined;
}

/**
 * Commands must match src-tauri/src/lib.rs, with argument names in camelCase
 * here for snake_case there.
 */
export function tauriBindings(
  { core: { invoke }, event: { listen } }: TauriGlobal,
): Partial<DesktopBindings> {
  return {
    pageReady: (background) =>
      invoke("page_ready", { background: background ?? null }) as Promise<
        void
      >,
    saveProfile: (filename, xml, signWith) =>
      invoke("save_profile", {
        filename,
        xml,
        signWith: signWith ?? null,
      }) as Promise<void>,
    shareProfile: (filename, xml, signWith, { x, y, width, height }) =>
      invoke("share_profile", {
        filename,
        xml,
        signWith: signWith ?? null,
        anchor: { x, y, width, height },
      }) as Promise<void>,
    setShareEnabled: (enabled) =>
      invoke("set_share_enabled", { enabled }) as Promise<void>,
    onShareRequested: async (listener) => {
      await listen(SHARE_EVENT, () => listener());
    },
    listSigningIdentities: () =>
      invoke("list_signing_identities") as Promise<SigningIdentity[]>,
    ask: (message) => invoke("ask", { message }) as Promise<boolean>,
    tell: (message) => invoke("tell", { message }) as Promise<void>,
    takeOpenedProfile: () =>
      invoke("take_opened_profile") as Promise<OpenedProfile | null>,
    onProfilesOpened: async (listener) => {
      await listen(OPENED_EVENT, () => listener());
    },
    setSaveAction: (label, enabled) =>
      invoke("set_save_action", { label, enabled }) as Promise<void>,
    onSaveRequested: async (listener) => {
      await listen(SAVE_EVENT, () => listener());
    },
    setAppearance: (appearance) =>
      invoke("set_appearance", { appearance }) as Promise<void>,
    onAppearanceChosen: async (listener) => {
      await listen(APPEARANCE_EVENT, (event) => {
        const appearance = payloadOf(event);
        if (APPEARANCES.includes(appearance)) {
          listener(appearance as Appearance);
        }
      });
    },
    showCardMenu: (fix) => invoke("show_card_menu", { fix }) as Promise<void>,
    onCardMenuChosen: async (listener) => {
      await listen(CARD_MENU_EVENT, (event) => {
        const action = payloadOf(event);
        if (CARD_ACTIONS.includes(action)) listener(action as CardAction);
      });
    },
  };
}

export function desktopBindings(): Partial<DesktopBindings> | undefined {
  const tauri = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__;
  return typeof tauri?.core?.invoke === "function" &&
      typeof tauri.event?.listen === "function"
    ? tauriBindings(tauri)
    : undefined;
}
