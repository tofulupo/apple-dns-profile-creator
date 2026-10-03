import { element } from "./dom.ts";

/** The most the tab shows exactly; more read as "9+". */
const MAX_SHOWN = 9;

export function countLabel(count: number): string {
  if (count <= 0) return "";
  return count > MAX_SHOWN ? `${MAX_SHOWN}+` : String(count);
}

export function showProfileCount(count: number): void {
  const badge = element("profileCount");
  const tab = badge.parentElement;
  if (tab === null) return;
  const label = tab.dataset["label"] ??= tab.textContent.trim();

  badge.textContent = countLabel(count);
  badge.hidden = count <= 0;
  if (count <= 0) tab.removeAttribute("aria-label");
  else {
    tab.setAttribute(
      "aria-label",
      `${label}, ${count} ${count === 1 ? "configuration" : "configurations"}`,
    );
  }
}
