/**
 * The desktop app's bindings, as the pages see them.
 */
import type { DesktopBindings, SigningIdentity } from "../desktop/bindings.ts";

type Invoke = (
  command: string,
  args?: Record<string, unknown>,
) => Promise<unknown>;

/**
 * What the Tauri app injects as `__TAURI__` (`withGlobalTauri` in
 * src-tauri/tauri.conf.json). Only the part used here is declared.
 */
interface TauriGlobal {
  readonly core: { readonly invoke: Invoke };
}

/**
 * The Tauri app's commands (src-tauri/src/lib.rs) as bindings. Tauri passes
 * arguments by name, camelCase here for snake_case on the Rust side, so each
 * is mapped here.
 * The results are cast: the Rust signatures are what guarantees them.
 */
export function tauriBindings(invoke: Invoke): Partial<DesktopBindings> {
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
    listSigningIdentities: () =>
      invoke("list_signing_identities") as Promise<SigningIdentity[]>,
    ask: (message) => invoke("ask", { message }) as Promise<boolean>,
    tell: (message) => invoke("tell", { message }) as Promise<void>,
  };
}

/**
 * The desktop app's bindings, or undefined in a browser, where there is no
 * `__TAURI__`.
 */
export function desktopBindings(): Partial<DesktopBindings> | undefined {
  const invoke = (globalThis as { __TAURI__?: TauriGlobal }).__TAURI__?.core
    .invoke;
  return typeof invoke === "function" ? tauriBindings(invoke) : undefined;
}
