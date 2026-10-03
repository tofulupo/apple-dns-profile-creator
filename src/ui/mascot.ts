/** CSS pixels in front of the screen: the nearer, the more it turns. */
const DISTANCE = 500;

/**
 * Degrees. Added to the pose's -11° and 14°, that stays within 25° and 28°,
 * past which the flat drawing shows it is flat.
 */
const MAX_TURN = 14;

export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Turn {
  readonly x: number;
  readonly y: number;
}

export function turnToward(
  from: Point,
  to: Point,
  distance = DISTANCE,
  max = MAX_TURN,
): Turn {
  const degrees = (radians: number) =>
    Math.min(max, Math.max(-max, radians * 180 / Math.PI));
  return {
    x: degrees(Math.atan2(from.y - to.y, distance)),
    y: degrees(Math.atan2(to.x - from.x, distance)),
  };
}

function center(element: Element): Point {
  const rect = element.getBoundingClientRect();
  return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
}

export function enableMascot(): void {
  const mascot = document.querySelector<HTMLElement>(".brand__mascot");
  if (mascot === null) return;
  // Set by src/ui/settings.ts.
  const reducesMotion = () =>
    document.documentElement.dataset["motion"] === "reduce";

  document.addEventListener("focusin", (event) => {
    if (reducesMotion() || !(event.target instanceof Element)) return;
    const target = event.target.closest(".zone") ?? event.target;
    const turn = turnToward(center(mascot), center(target));
    mascot.style.setProperty("--mascot-turn-x", `${turn.x.toFixed(1)}deg`);
    mascot.style.setProperty("--mascot-turn-y", `${turn.y.toFixed(1)}deg`);
  });

  document.addEventListener("focusout", (event) => {
    if (event.relatedTarget !== null) return;
    mascot.style.removeProperty("--mascot-turn-x");
    mascot.style.removeProperty("--mascot-turn-y");
  });
}
