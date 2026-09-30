/**
 * Text field edits that keep the field's own undo history, and Escape to
 * revert a field, as in a native Mac text field.
 *
 * Setting `value` from a script bypasses the browser's undo stack: ⌘Z cannot
 * undo that change, and may lose earlier steps too. `execCommand("insertText")`
 * edits the field as typing would, so it is undoable. It is deprecated, but
 * it is still the only way to make an undoable change, and it works in every
 * current browser. It only edits the focused field.
 */

export type TextField = HTMLInputElement | HTMLTextAreaElement;

const TEXT_TYPES = new Set(["text", "search", "url", "email", "tel"]);

function isTextField(target: EventTarget | null): target is TextField {
  const field = target instanceof HTMLTextAreaElement ||
      (target instanceof HTMLInputElement && TEXT_TYPES.has(target.type))
    ? target
    : undefined;
  return field !== undefined && !field.readOnly && !field.disabled;
}

/**
 * Makes `text` the content of `field`: undoably if it has the focus, by
 * setting `value` otherwise. Either way the field fires `input`, as typing
 * would, when its content changes. The caret ends at `caret`, or after the
 * text.
 */
export function replaceText(
  field: TextField,
  text: string,
  caret = text.length,
): void {
  if (field.value === text) return;
  let edited = false;
  if (document.activeElement === field) {
    field.select();
    // Inserting nothing is not an edit; deleting the selection is.
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

/**
 * Inserts `text` at the caret of the focused `field`, replacing any
 * selection, undoably where the browser can.
 */
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

/**
 * Whether an `input` event comes from ⌘Z or ⇧⌘Z. Code that rewrites what was
 * typed must leave these alone, or undoing would redo the rewrite at once and
 * never get past it.
 */
export function isUndoOrRedo(event: Event): boolean {
  return event instanceof InputEvent && event.inputType.startsWith("history");
}

/**
 * Escape in a text field restores what it held when it got the focus, as an
 * edit ⌘Z can undo. When there is nothing to revert, or something else on the
 * page already handles the key (the preset menu closes first), Escape is left
 * alone.
 */
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
