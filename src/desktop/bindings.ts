/**
 * Functions `desktop.ts` exposes to the page as `bindings.<name>()`.
 *
 * The one declaration both sides use: `desktop.ts` types its handlers with it,
 * `src/ui/download.ts` types its calls, so the two cannot drift apart.
 * Arguments cross as JSON; a rejection reaches the page as a plain
 * `{ name, message, stack }` object rather than an `Error`.
 */
export interface DesktopBindings {
  /**
   * Saves the profile to ~/Downloads under `filename`, numbering it instead
   * of overwriting an existing file, then offers to open it for installation.
   */
  saveProfile(filename: string, xml: string): Promise<void>;
}
