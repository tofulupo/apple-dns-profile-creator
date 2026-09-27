/**
 * Tests for the configuration count on the Profile tab.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { countLabel } from "../../src/ui/profile_count.ts";

describe("countLabel", () => {
  it("shows nothing without configurations", () => {
    expect(countLabel(0)).toBe("");
  });

  it("shows the exact number from 1 to 9", () => {
    expect(countLabel(1)).toBe("(1)");
    expect(countLabel(9)).toBe("(9)");
  });

  it("caps at 9+", () => {
    expect(countLabel(10)).toBe("(9+)");
    expect(countLabel(250)).toBe("(9+)");
  });
});
