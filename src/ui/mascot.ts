/**
 * The desktop app's mascot in front of the name (pages/_mascot.html), which
 * turns toward whatever has focus, and back when focus leaves. css/app.css
 * holds its pose and eases the turn; this only works the turn out, as
 * --mascot-turn-x and --mascot-turn-y. The website has no mascot, and there
 * this does nothing.
 */

/**
 * How far in front of the screen the focused element is imagined, in CSS
 * pixels: the nearer, the more it turns.
 */
const DISTANCE = 500;

/**
 * The furthest it turns either way, in degrees. Added to the pose's -11° and
 * 14°, that stays within 25° and 28°, past which the flat drawing shows it is
 * flat.
 */
const MAX_TURN = 14;

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** Degrees for rotateX and rotateY: up and right are positive. */
export interface Turn {
  readonly x: number;
  readonly y: number;
}

/** The turn from `from` toward `to`, both points on the screen. */
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
  const reduceMotion = matchMedia("(prefers-reduced-motion: reduce)");

  document.addEventListener("focusin", (event) => {
    if (reduceMotion.matches || !(event.target instanceof Element)) return;
    // The upload zone's input is visually hidden: look at the zone.
    const target = event.target.closest(".zone") ?? event.target;
    const turn = turnToward(center(mascot), center(target));
    mascot.style.setProperty("--mascot-turn-x", `${turn.x.toFixed(1)}deg`);
    mascot.style.setProperty("--mascot-turn-y", `${turn.y.toFixed(1)}deg`);
  });

  // Moving on to another element turns it there instead (focusin).
  document.addEventListener("focusout", (event) => {
    if (event.relatedTarget !== null) return;
    mascot.style.removeProperty("--mascot-turn-x");
    mascot.style.removeProperty("--mascot-turn-y");
  });
}
