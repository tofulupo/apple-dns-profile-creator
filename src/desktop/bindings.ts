/**
 * The desktop app's commands (src-tauri/src/lib.rs) as the pages call them.
 *
 * The one declaration the page side uses: `src/ui/desktop.ts` maps each to its
 * Rust command, and `src/ui/download.ts`, `src/ui/signing.ts`,
 * `src/ui/dialogs.ts` and `src/ui/page_ready.ts` type their calls with it.
 * Arguments and results cross as JSON; a failed command rejects with the Rust
 * side's error message as a plain string rather than an `Error`.
 */

/**
 * Whether macOS trusts a certificate's chain. Expired certificates are never
 * offered, so they have no status.
 */
export type IdentityStatus = "trusted" | "untrusted";

/** A Keychain certificate with its private key, usable for signing. */
export interface SigningIdentity {
  /** SHA-1 fingerprint of the certificate: unique, unlike the name. */
  readonly id: string;
  /** The certificate's name as Keychain Access shows it. */
  readonly name: string;
  readonly status: IdentityStatus;
}

/** A profile opened with the app, from Finder, the Dock or File > Open. */
export interface OpenedProfile {
  /** The file name. */
  readonly name: string;
  /** The file's content, decoded as a dropped file's `text()` would be. */
  readonly text: string;
}

/** The theme switch's choices, as View > Appearance offers them. */
export type Appearance = "system" | "light" | "dark";

/** The items of a profile card's context menu. */
export type CardAction = "edit" | "delete";

export interface DesktopBindings {
  /**
   * Saves the profile to ~/Downloads under `filename`, numbering it instead
   * of overwriting an existing file, then offers to open it for installation.
   * With `signWith`, the id of a listed identity, the profile is signed with
   * that Keychain identity first.
   */
  saveProfile(filename: string, xml: string, signWith?: string): Promise<void>;

  /** Identities in the Keychain that can sign, expired ones left out. */
  listSigningIdentities(): Promise<SigningIdentity[]>;

  /**
   * Called by each page once it is ready to paint, and again whenever its
   * background changes. The window starts hidden, since until then it shows
   * an empty white webview, even in dark mode; only the first call shows it.
   * `background` is the page's background colour as red, green and blue,
   * which the app gives the webview so no white shows before the page's first
   * frame.
   */
  pageReady(background?: readonly [number, number, number]): Promise<void>;

  /**
   * `confirm()` as a native dialog: whether the user chose OK. The app's
   * webview shows no `confirm()` dialog of its own. Call `ask` in
   * src/ui/dialogs.ts rather than this.
   */
  ask(message: string): Promise<boolean>;

  /** `alert()` as a native dialog; see `ask`. Call `tell` in src/ui/dialogs.ts. */
  tell(message: string): Promise<void>;

  /**
   * The oldest profile opened with the app that no page has taken yet, or
   * null. Each is handed out once. Use `receiveOpenedProfiles` in
   * src/ui/opened.ts rather than this.
   */
  takeOpenedProfile(): Promise<OpenedProfile | null>;

  /**
   * Calls `listener` whenever profiles are opened with the app while the
   * page is open. Resolves once listening.
   */
  onProfilesOpened(listener: () => void): Promise<void>;

  /**
   * Names File > Save (⌘S) for what the page's main button does, and enables
   * it while that button can be used.
   */
  setSaveAction(label: string, enabled: boolean): Promise<void>;

  /** Calls `listener` whenever File > Save (⌘S) is chosen. */
  onSaveRequested(listener: () => void): Promise<void>;

  /**
   * Checks `appearance` in View > Appearance and gives it to the app's title
   * bar, menus and dialogs, which otherwise follow the system.
   */
  setAppearance(appearance: Appearance): Promise<void>;

  /** Calls `listener` with what is chosen in View > Appearance. */
  onAppearanceChosen(
    listener: (appearance: Appearance) => void,
  ): Promise<void>;

  /**
   * Shows a profile card's context menu at the pointer, with Fix rather than
   * Edit when `fix`. The choice arrives through `onCardMenuChosen`.
   */
  showCardMenu(fix: boolean): Promise<void>;

  /** Calls `listener` with the item chosen in a card's context menu. */
  onCardMenuChosen(listener: (action: CardAction) => void): Promise<void>;
}
