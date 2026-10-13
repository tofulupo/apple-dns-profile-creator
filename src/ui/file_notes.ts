import type { Note, NoteAction } from "./notes.ts";

export type Act = (action: NoteAction["id"]) => void;

export function fileName(name: string): HTMLElement {
  const strong = document.createElement("strong");
  strong.textContent = name.replace(/\.mobileconfig$/i, "");
  strong.title = name;
  return strong;
}

function el(
  tag: string,
  className: string,
  ...children: (Node | string)[]
): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  node.append(...children);
  return node;
}

function noteClass(note: Note): string {
  return `file-note file-note--${note.tone}${
    note.calm === true ? " file-note--calm" : ""
  }`;
}

function leftOutTile(note: Note, items: readonly string[]): HTMLElement {
  const chevron = el("span", "icon icon--chevron");
  chevron.setAttribute("aria-hidden", "true");
  return el(
    "details",
    `${noteClass(note)} file-note--wide`,
    el(
      "summary",
      "",
      el("span", "file-note__label", note.label),
      el(
        "span",
        "file-note__value",
        note.value,
        chevron,
      ),
    ),
    el("ul", "file-note__list", ...items.map((item) => el("li", "", item))),
  );
}

function actionRow(action: NoteAction, act: Act): HTMLElement {
  const button = el(
    "button",
    action.quiet === true
      ? "file-note__link"
      : "btn btn--small file-note__action",
    action.label,
  ) as HTMLButtonElement;
  button.type = "button";
  button.dataset["action"] = action.id;
  button.addEventListener("click", () => act(action.id));
  return el(
    "p",
    "file-note__do",
    button,
    ...(action.hint === undefined
      ? []
      : [el("span", "file-note__hint", action.hint)]),
  );
}

function tile(note: Note, act: Act | undefined): HTMLElement {
  if (note.items !== undefined) return leftOutTile(note, note.items);
  return el(
    "div",
    noteClass(note),
    el("p", "file-note__label", note.label),
    el("p", "file-note__value", note.value),
    ...(note.text === undefined ? [] : [el("p", "file-note__text", note.text)]),
    ...(note.action === undefined || act === undefined
      ? []
      : [actionRow(note.action, act)]),
  );
}

export function showFileNotes(
  list: HTMLElement,
  notes: readonly Note[],
  act?: Act,
): void {
  list.replaceChildren(...notes.map((note) => tile(note, act)));
  list.classList.toggle(
    "file-notes--calm",
    notes.every((note) => note.calm === true),
  );
  list.hidden = notes.length === 0;
}
