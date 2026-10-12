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

/**
 * On phones the popup sits on the floating bar, as wide as the bar; in the
 * header it hangs from the pill, right edges aligned. It grows out of the pill
 * (--privacy-origin, read by the stylesheet).
 */
function place(panel: HTMLElement, pill: HTMLElement): void {
  const box = pill.getBoundingClientRect();
  const dock = pill.closest(".dock");
  const bar = dock !== null && getComputedStyle(dock).position === "fixed"
    ? dock.getBoundingClientRect()
    : undefined;
  const margin = 8;
  let left: number;
  if (bar !== undefined) {
    left = bar.left;
    panel.style.width = `${bar.width}px`;
    panel.style.top = "auto";
    panel.style.bottom = `${innerHeight - bar.top + 6}px`;
  } else {
    const width = Math.min(320, innerWidth - 2 * margin);
    left = Math.max(margin, Math.min(box.right - width, innerWidth - width));
    panel.style.width = `${width}px`;
    panel.style.top = `${box.bottom + margin}px`;
    panel.style.bottom = "auto";
  }
  panel.style.left = `${left}px`;
  panel.style.setProperty(
    "--privacy-origin",
    `${box.left + box.width / 2 - left}px ${bar === undefined ? "0" : "100%"}`,
  );
}

/** The website's Privacy pill (pages/_privacy.html); the app has none. */
export function enablePrivacy(): void {
  const pill = document.getElementById("keepPill");
  const panel = document.getElementById("keepPanel");
  const toggle = document.getElementById("keepChk");
  const hint = document.getElementById("keepHint");
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
  panel.addEventListener("beforetoggle", (event) => {
    const open = (event as ToggleEvent).newState === "open";
    pill.classList.toggle("is-open", open);
    if (open) place(panel, pill);
  });
  addEventListener("resize", () => {
    if (panel.matches(":popover-open")) place(panel, pill);
  });
}
