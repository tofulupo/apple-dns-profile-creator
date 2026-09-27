/**
 * Functions `desktop.ts` exposes to the page as `bindings.<name>()`.
 *
 * The one declaration both sides use: `desktop.ts` types its handlers with it,
 * `src/ui/download.ts` and `src/ui/signing.ts` type their calls, so the two
 * cannot drift apart. Arguments cross as JSON; a rejection reaches the page as
 * a plain `{ name, message, stack }` object rather than an `Error`.
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
   * The page's stored data from the last launch. The webview's own storage
   * starts empty on each launch, since the app's origin changes.
   */
  loadStorage(): Promise<Record<string, string>>;

  /** Replaces the stored data kept for the next launch. */
  saveStorage(data: Record<string, string>): Promise<void>;

  /**
   * Called by each page once it has painted. The window starts hidden, since
   * until then it shows an empty white webview, even in dark mode.
   */
  pageReady(): Promise<void>;
}
