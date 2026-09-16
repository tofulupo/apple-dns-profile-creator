/**
 * Small typed DOM helpers.
 */

export function element<T extends HTMLElement>(id: string): T {
  const found = document.getElementById(id);
  if (found === null) {
    throw new Error(`Missing element #${id}`);
  }
  return found as T;
}

export const input = (id: string): HTMLInputElement =>
  element<HTMLInputElement>(id);

export const textarea = (id: string): HTMLTextAreaElement =>
  element<HTMLTextAreaElement>(id);

export function setFieldError(
  field: HTMLElement,
  message: string | null,
): void {
  const error = field.querySelector(".field__error");
  field.classList.toggle("field--invalid", message !== null);
  if (error instanceof HTMLElement) {
    error.textContent = message ?? "";
    error.hidden = message === null;
  }

  // A field inside a collapsed <details> would report its error invisibly,
  // leaving the submit button looking inert for no stated reason.
  if (message !== null) {
    const disclosure = field.closest("details");
    if (disclosure instanceof HTMLDetailsElement) disclosure.open = true;
  }
}
