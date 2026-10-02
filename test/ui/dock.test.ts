/**
 * Tests for telling an on-screen keyboard apart, which hides the floating bar.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { keyboardOpen } from "../../src/ui/dock.ts";

describe("keyboardOpen", () => {
  it("is closed when the whole page shows", () => {
    expect(keyboardOpen(844, 844, 1)).toBe(false);
  });

  it("opens when a keyboard covers part of the page", () => {
    expect(keyboardOpen(844, 508, 1)).toBe(true);
  });

  // Collapsing toolbars and an iPad's shortcut bar stay well under it.
  it("ignores small changes", () => {
    expect(keyboardOpen(844, 790, 1)).toBe(false);
  });

  it("ignores a viewport that grows past the layout", () => {
    expect(keyboardOpen(800, 880, 1)).toBe(false);
  });

  // Zoomed in twice, the visual viewport is half as tall, with no keyboard.
  it("does not take pinch zoom for a keyboard", () => {
    expect(keyboardOpen(844, 422, 2)).toBe(false);
    expect(keyboardOpen(844, 254, 2)).toBe(true);
  });
});
