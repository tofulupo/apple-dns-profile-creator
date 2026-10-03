import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { turnToward } from "../../src/ui/mascot.ts";

const mascot = { x: 100, y: 100 };

describe("turnToward", () => {
  it("does not turn toward a point straight ahead", () => {
    const turn = turnToward(mascot, mascot);
    expect(turn.x).toBeCloseTo(0);
    expect(turn.y).toBeCloseTo(0);
  });

  it("turns right and down toward a field to the right and below", () => {
    const turn = turnToward(mascot, { x: 200, y: 200 }, 500, 14);
    expect(turn.x).toBeLessThan(0);
    expect(turn.y).toBeGreaterThan(0);
  });

  it("turns up toward the title bar's tabs, above it", () => {
    expect(turnToward(mascot, { x: 100, y: 20 }, 500, 14).x)
      .toBeGreaterThan(0);
  });

  it("turns as far as the point lies, imagined that far in front", () => {
    // 500px across at 500px away: 45 degrees, under a limit of 60.
    expect(turnToward(mascot, { x: 600, y: 100 }, 500, 60).y)
      .toBeCloseTo(45);
  });

  it("never turns past the limit, however far the point", () => {
    const turn = turnToward(mascot, { x: -5000, y: 5000 }, 500, 14);
    expect(turn.x).toBe(-14);
    expect(turn.y).toBe(-14);
  });
});
