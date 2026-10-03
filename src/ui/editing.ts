export type TextField = HTMLInputElement | HTMLTextAreaElement;

const TEXT_TYPES = new Set(["text", "search", "url", "email", "tel"]);

function isTextField(target: EventTarget | null): target is TextField {
  const field = target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement && TEXT_TYPES.has(target.type))
    ? target
    : undefined;
  return field !== undefined && !field.readOnly && !field.disabled;
}

export function replaceText(
  field: TextField,
  text: string,
  caret = text.length,
): void {
  if (field.value === text) return;
  let edited = false;
  if (document.activeElement === field) {
    field.select();
    edited = text === ""
      ? document.execCommand("delete")
      : document.execCommand("insertText", false, text);
  }
  if (!edited) {
    field.value = text;
    field.dispatchEvent(new Event("input", { bubbles: true }));
  }
  field.setSelectionRange(caret, caret);
}

export function insertText(field: TextField, text: string): void {
  if (
    document.activeElement === field &&
    document.execCommand("insertText", false, text)
  ) {
    return;
  }
  const end = field.value.length;
  field.setRangeText(
    text,
    field.selectionStart ?? end,
    field.selectionEnd ?? end,
    "end",
  );
  field.dispatchEvent(new Event("input", { bubbles: true }));
}

export function isUndoOrRedo(event: Event): boolean {
  return event instanceof InputEvent && event.inputType.startsWith("history");
}

export function enableEscapeRevert(root: Document = document): void {
  const original = new WeakMap<TextField, string>();
  root.addEventListener("focusin", (event) => {
    if (isTextField(event.target)) {
      original.set(event.target, event.target.value);
    }
  });
  root.addEventListener("keydown", (event) => {
    if (
      event.key !== "Escape" || event.defaultPrevented || event.isComposing ||
      event.metaKey || event.ctrlKey || event.altKey || event.shiftKey
    ) {
      return;
    }
    const field = event.target;
    if (!isTextField(field)) return;
    const before = original.get(field);
    if (before === undefined || before === field.value) return;
    event.preventDefault();
    replaceText(field, before);
  });
}
