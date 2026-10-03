/**
 * The desktop app's commands (src-tauri/src/lib.rs) as the pages call them.
 * `src/ui/desktop.ts` maps each to its Rust command. A failed command rejects
 * with the Rust error message as a plain string, not an `Error`.
 */

export type IdentityStatus = "trusted" | "untrusted";

export interface SigningIdentity {
  /** SHA-1 fingerprint of the certificate, passed back as `signWith`. */
  readonly id: string;
  readonly name: string;
  readonly status: IdentityStatus;
}

export interface OpenedProfile {
  readonly name: string;
  readonly text: string;
}

export type Appearance = "system" | "light" | "dark";

export type CardAction = "edit" | "delete";

/** CSS pixels from the viewport's top left, as `getBoundingClientRect()`. */
export interface Anchor {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface DesktopBindings {
  /** Saves to ~/Downloads without overwriting, signed with `signWith` if set. */
  saveProfile(filename: string, xml: string, signWith?: string): Promise<void>;

  /** Opens the share menu below `anchor`; resolves once the menu is open. */
  shareProfile(
    filename: string,
    xml: string,
    signWith: string | undefined,
    anchor: Anchor,
  ): Promise<void>;

  /** Enables File > Share…, which is off after each page load. */
  setShareEnabled(enabled: boolean): Promise<void>;

  /** Calls `listener` whenever File > Share… is chosen. */
  onShareRequested(listener: () => void): Promise<void>;

  /** Keychain identities that can sign, expired ones left out. */
  listSigningIdentities(): Promise<SigningIdentity[]>;

  /** Shows the window on the first call and sets the webview background. */
  pageReady(background?: readonly [number, number, number]): Promise<void>;

  /** Native `confirm()`. Call `ask` in src/ui/dialogs.ts instead. */
  ask(message: string): Promise<boolean>;

  /** Native `alert()`. Call `tell` in src/ui/dialogs.ts instead. */
  tell(message: string): Promise<void>;

  /** The oldest opened profile not yet taken, or null. Use src/ui/opened.ts. */
  takeOpenedProfile(): Promise<OpenedProfile | null>;

  /** Calls `listener` when profiles are opened; resolves once listening. */
  onProfilesOpened(listener: () => void): Promise<void>;

  /** Names and enables File > Save (⌘S). */
  setSaveAction(label: string, enabled: boolean): Promise<void>;

  /** Calls `listener` whenever File > Save (⌘S) is chosen. */
  onSaveRequested(listener: () => void): Promise<void>;

  /** Sets the title bar, menus and dialogs to `appearance`. */
  setAppearance(appearance: Appearance): Promise<void>;

  /** Calls `listener` with what is chosen in View > Appearance. */
  onAppearanceChosen(
    listener: (appearance: Appearance) => void,
  ): Promise<void>;

  /** Shows a card's context menu, with Fix instead of Edit when `fix`. */
  showCardMenu(fix: boolean): Promise<void>;

  /** Calls `listener` with the item chosen in a card's context menu. */
  onCardMenuChosen(listener: (action: CardAction) => void): Promise<void>;
}
