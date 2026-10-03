export function holdStillWhenFitting(): void {
  const root = document.documentElement;
  if (root.dataset["app"] !== "desktop") return;
  const update = (): void => {
    root.toggleAttribute("data-fits", root.scrollHeight <= root.clientHeight);
  };
  new ResizeObserver(update).observe(root);
  addEventListener("resize", update);
  update();
}
