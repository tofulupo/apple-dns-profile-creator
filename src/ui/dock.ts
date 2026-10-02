/**
 * The floating bar on phones and tablets (`.dock` in css/app.css) steps away
 * while an on-screen keyboard is open, which would otherwise push it over the
 * field being typed in or leave it jumping about.
 *
 * Only a keyboard that is really there counts: it shrinks the visual viewport,
 * on iOS and on Android alike, while a hardware keyboard (an iPad's, a Surface's
 * Type Cover) and browser device emulation never do. Marked as `data-keyboard`
 * on the root element.
 */

/** Less than any on-screen keyboard, more than a browser's toolbars. */
const KEYBOARD_MIN_HEIGHT = 150;

/**
 * Whether an on-screen keyboard covers the page: the visual viewport, scaled
 * back up to cancel out pinch zoom, falls short of the layout viewport.
 */
export function keyboardOpen(
  layoutHeight: number,
  viewportHeight: number,
  scale: number,
): boolean {
  return layoutHeight - viewportHeight * scale > KEYBOARD_MIN_HEIGHT;
}

export function watchKeyboard(): void {
  const viewport = globalThis.visualViewport;
  if (viewport === null || viewport === undefined) return;
  const root = document.documentElement;
  const update = () => {
    root.toggleAttribute(
      "data-keyboard",
      keyboardOpen(root.clientHeight, viewport.height, viewport.scale),
    );
  };
  viewport.addEventListener("resize", update);
  update();
}
