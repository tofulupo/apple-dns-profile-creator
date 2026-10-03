import { desktopBindings } from "./desktop.ts";

let open = 0;

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

export async function ask(message: string): Promise<boolean> {
  const native = desktopBindings()?.ask;
  if (typeof native !== "function") return confirm(message);
  try {
    return await whileOpen(() => native(message));
  } catch (error) {
    console.error("Could not ask:", error, message);
    return false;
  }
}

export async function tell(message: string): Promise<void> {
  const native = desktopBindings()?.tell;
  if (typeof native !== "function") return alert(message);
  try {
    await whileOpen(() => native(message));
  } catch (error) {
    console.error("Could not show a message:", error, message);
  }
}
