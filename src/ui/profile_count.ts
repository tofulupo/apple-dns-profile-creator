/**
 * The number of stored configurations on the Profile tab, shown on every page.
 */

import { element } from "./dom.ts";

/** The most the tab shows exactly; more read as "9+". */
const MAX_SHOWN = 9;

/**
 * The count as the tab shows it: "1" to "9", then "9+"; none at 0. The tab
 * shows it in a badge, in the header and the floating bar (css/app.css).
 */
export function countLabel(count: number): string {
  if (count <= 0) return "";
  return count > MAX_SHOWN ? `${MAX_SHOWN}+` : String(count);
}

export function showProfileCount(count: number): void {
  const badge = element("profileCount");
  const tab = badge.parentElement;
  if (tab === null) return;
  // Read before the first count is added, so it is the tab's own label.
  const label = tab.dataset["label"] ??= tab.textContent.trim();

  badge.textContent = countLabel(count);
  badge.hidden = count <= 0;
  // "9+" would be read out as is, so assistive tech gets the exact number.
  if (count <= 0) tab.removeAttribute("aria-label");
  else {
    tab.setAttribute(
      "aria-label",
      `${label}, ${count} ${count === 1 ? "configuration" : "configurations"}`,
    );
  }
}
