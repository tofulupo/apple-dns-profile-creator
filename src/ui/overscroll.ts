/**
 * Keeps the desktop app's page still when it fits its window.
 *
 * WebKit lets a trackpad pull the page past its ends and spring back, even
 * when there is nothing to scroll, so the whole window content wobbles. A
 * native Mac window whose content fits does not move. `data-fits` on the root
 * element says the page fits, and css/app.css turns the bounce off then; a
 * page taller than the window keeps it at its ends, as native scroll views do.
 * Does nothing in a browser.
 */
export function holdStillWhenFitting(): void {
  const root = document.documentElement;
  if (root.dataset["app"] !== "desktop") return;
  const update = (): void => {
    root.toggleAttribute("data-fits", root.scrollHeight <= root.clientHeight);
  };
  // The root grows and shrinks with the content (a section opened, a card
  // added), while the window's own size only shows in `resize`.
  new ResizeObserver(update).observe(root);
  addEventListener("resize", update);
  update();
}
