/**
 * Tests for the desktop app's pixel font: ⌘G six times in a row.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { pressCounter } from "../../src/ui/pixel.ts";

/** Which of the presses, at these times, complete a run. */
function completing(times: number[]): number[] {
  const pressed = pressCounter(6, 1000);
  return times.flatMap((time, index) => pressed(time) ? [index] : []);
}

describe("pressCounter", () => {
  it("fires on the sixth press in a row", () => {
    expect(completing([0, 300, 600, 900, 1200, 1500])).toEqual([5]);
  });

  it("starts over after firing, so six more switch it back", () => {
    const times = Array.from({ length: 12 }, (_, i) => i * 200);
    expect(completing(times)).toEqual([5, 11]);
  });

  it("starts over after a pause longer than a second", () => {
    expect(completing([0, 200, 400, 1500, 1700, 1900, 2100, 2300, 2500]))
      .toEqual([8]);
  });

  it("counts a pause of exactly a second as in a row", () => {
    expect(completing([0, 1000, 2000, 3000, 4000, 5000])).toEqual([5]);
  });

  it("never fires on five", () => {
    expect(completing([0, 100, 200, 300, 400])).toEqual([]);
  });
});
