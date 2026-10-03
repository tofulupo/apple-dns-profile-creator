/** Less than any on-screen keyboard, more than a browser's toolbars. */
const KEYBOARD_MIN_HEIGHT = 150;

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
