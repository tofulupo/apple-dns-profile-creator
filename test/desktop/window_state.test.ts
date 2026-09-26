/**
 * Tests for remembering the desktop window's size.
 */
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join } from "@std/path";

import {
  DEFAULT_WINDOW_SIZE,
  loadWindowSize,
  parseWindowSize,
  saveWindowSize,
} from "../../src/desktop/window_state.ts";

describe("parseWindowSize", () => {
  it("accepts a sensible size and rounds it", () => {
    expect(parseWindowSize({ width: 1024.4, height: 768.6 })).toEqual({
      width: 1024,
      height: 769,
    });
  });

  it("ignores extra keys, such as a position", () => {
    expect(parseWindowSize({ width: 800, height: 600, x: -5000 })).toEqual({
      width: 800,
      height: 600,
    });
  });

  it("rejects anything that is not a usable size", () => {
    for (
      const value of [
        null,
        "800x600",
        [800, 600],
        {},
        { width: 800 },
        { width: "800", height: 600 },
        { width: 10, height: 600 },
        { width: 800, height: 1e9 },
        { width: Number.NaN, height: 600 },
        { width: Number.POSITIVE_INFINITY, height: 600 },
      ]
    ) {
      expect(parseWindowSize(value)).toBeUndefined();
    }
  });
});

describe("loading and saving", () => {
  let folder: string;
  let file: string;

  beforeEach(async () => {
    folder = await Deno.makeTempDir({ prefix: "dns-mobileconfig-window-" });
    // Nested, as the real Application Support folder may not exist yet.
    file = join(folder, "Application Support", "app.id", "window.json");
  });

  afterEach(async () => {
    await Deno.remove(folder, { recursive: true });
  });

  it("falls back to the default on first launch", async () => {
    expect(await loadWindowSize(file)).toEqual(DEFAULT_WINDOW_SIZE);
  });

  it("round-trips a saved size, creating the folder", async () => {
    await saveWindowSize(file, { width: 1100, height: 700 });
    expect(await loadWindowSize(file)).toEqual({ width: 1100, height: 700 });
  });

  it("falls back to the default for a corrupt or out-of-range file", async () => {
    await saveWindowSize(file, { width: 1100, height: 700 });
    await Deno.writeTextFile(file, "{not json");
    expect(await loadWindowSize(file)).toEqual(DEFAULT_WINDOW_SIZE);
    await Deno.writeTextFile(file, '{"width":5,"height":5}');
    expect(await loadWindowSize(file)).toEqual(DEFAULT_WINDOW_SIZE);
  });

  it("does not save a size it would refuse to load", async () => {
    await saveWindowSize(file, { width: 1100, height: 700 });
    await saveWindowSize(file, { width: 1, height: 1 });
    expect(await loadWindowSize(file)).toEqual({ width: 1100, height: 700 });
  });
});
