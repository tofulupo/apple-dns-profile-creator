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

  if (message !== null) openEnclosing(field);
}

export function setFieldValid(field: HTMLElement, valid: boolean): void {
  field.classList.toggle("field--valid", valid);
}

export function openEnclosing(element: Element): void {
  for (
    let disclosure = element.closest("details");
    disclosure !== null;
    disclosure = disclosure.parentElement?.closest("details") ?? null
  ) {
    disclosure.open = true;
  }
}
