/**
 * `confirm()` and `alert()` that also work in the desktop app, whose webview
 * shows neither: there `confirm()` returns false at once and `alert()` does
 * nothing. Its native dialogs are asynchronous, so these are too. In a
 * browser they are the built-in dialogs.
 */

import { desktopBindings } from "./desktop.ts";

let open = 0;

/**
 * Whether a native dialog is waiting for an answer. The app's menu shortcuts
 * still reach the page meanwhile, and must not act behind the dialog.
 */
export function dialogOpen(): boolean {
  return open > 0;
}

async function whileOpen<T>(dialog: () => Promise<T>): Promise<T> {
  open++;
  try {
    return await dialog();
  } finally {
    open--;
  }
}

/** Whether the user chose OK. False when the dialog could not be shown. */
export async function ask(message: string): Promise<boolean> {
  const native = desktopBindings()?.ask;
  if (typeof native !== "function") return confirm(message);
  try {
    return await whileOpen(() => native(message));
  } catch (error) {
    // No answer is a no: every question here guards a change.
    console.error("Could not ask:", error, message);
    return false;
  }
}

/** Resolves once the user has dismissed the message. */
export async function tell(message: string): Promise<void> {
  const native = desktopBindings()?.tell;
  if (typeof native !== "function") return alert(message);
  try {
    await whileOpen(() => native(message));
  } catch (error) {
    console.error("Could not show a message:", error, message);
  }
}
