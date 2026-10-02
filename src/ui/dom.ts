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

/**
 * Lists `messages` as the items of `list`, hiding it when there are none.
 * Used for import warnings: things left out that are not errors.
 */
export function showNotices(
  list: HTMLElement,
  messages: readonly string[],
): void {
  list.replaceChildren(
    ...messages.map((message) => {
      const item = document.createElement("li");
      item.textContent = message;
      return item;
    }),
  );
  list.hidden = messages.length === 0;
}

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
  // leaving the submit button looking inert for no stated reason. Every
  // enclosing one is opened, since rows of Behavior & rules sit inside the
  // section's own.
  if (message !== null) openEnclosing(field);
}

/**
 * Marks `field` as holding a usable value, for fields whose format matters:
 * the server and the addresses, which show it in their own markers.
 */
export function setFieldValid(field: HTMLElement, valid: boolean): void {
  field.classList.toggle("field--valid", valid);
}

/** Opens every `<details>` around `element`, so it can be seen. */
export function openEnclosing(element: Element): void {
  for (
    let disclosure = element.closest("details");
    disclosure !== null;
    disclosure = disclosure.parentElement?.closest("details") ?? null
  ) {
    disclosure.open = true;
  }
}
