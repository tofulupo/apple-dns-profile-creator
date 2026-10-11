import { forgetsOnClose, setForgetOnClose } from "./storage.ts";

const HINT_ON =
  "Deletes cards and settings. For zero traces, use a private window.";
const HINT_OFF = "Cards and settings stay in this browser.";

function show(pill: HTMLElement, hint: HTMLElement, forget: boolean): void {
  pill.dataset["on"] = String(forget);
  pill.setAttribute(
    "aria-label",
    `Privacy: forget on close is ${forget ? "on" : "off"}`,
  );
  hint.textContent = forget ? HINT_ON : HINT_OFF;
}

function place(panel: HTMLElement, pill: HTMLElement): void {
  const box = pill.getBoundingClientRect();
  const margin = 8;
  const width = Math.min(340, innerWidth - 2 * margin);
  panel.style.width = `${width}px`;
  panel.style.left = `${
    Math.max(margin, Math.min(box.right - width, innerWidth - width - margin))
  }px`;
  const below = box.top < innerHeight / 2;
  panel.style.top = below ? `${box.bottom + margin}px` : "auto";
  panel.style.bottom = below ? "auto" : `${innerHeight - box.top + margin}px`;
}

/** The website's Privacy pill (pages/_privacy.html); the app has none. */
export function enablePrivacy(): void {
  const pill = document.getElementById("privacyPill");
  const panel = document.getElementById("privacyPanel");
  const toggle = document.getElementById("privacyChk");
  const hint = document.getElementById("privacyHint");
  if (
    pill === null || panel === null || hint === null ||
    !(toggle instanceof HTMLInputElement)
  ) return;

  let forget = true;
  try {
    forget = forgetsOnClose();
  } catch {
    // Blocked storage keeps nothing anyway.
  }
  toggle.checked = forget;
  show(pill, hint, forget);

  toggle.addEventListener("change", () => {
    try {
      setForgetOnClose(toggle.checked);
    } catch {
      toggle.checked = !toggle.checked;
      return;
    }
    show(pill, hint, toggle.checked);
  });
  panel.addEventListener("toggle", (event) => {
    if ((event as ToggleEvent).newState === "open") place(panel, pill);
  });
  addEventListener("resize", () => {
    if (panel.matches(":popover-open")) place(panel, pill);
  });
}
