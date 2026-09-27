/**
 * Tests for what the desktop app remembers between launches.
 */
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join } from "@std/path";

import {
  createStoredDataSaver,
  DEFAULT_WINDOW_SIZE,
  loadStoredData,
  loadWindowSize,
  MAX_STORED_BYTES,
  parseStoredData,
  parseWindowSize,
  removeLeftoverTemporaryFiles,
  removeOldWebsiteData,
  saveStoredData,
  saveWindowSize,
  STORED_KEY_PREFIX,
} from "../../src/desktop/app_state.ts";
import { KEY_PREFIX } from "../../src/ui/storage.ts";

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

describe("loading and saving the window size", () => {
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

  it("leaves no temporary file behind", async () => {
    await saveWindowSize(file, { width: 1100, height: 700 });
    await saveWindowSize(file, { width: 1000, height: 700 });
    const names = [];
    for await (const entry of Deno.readDir(join(file, ".."))) {
      names.push(entry.name);
    }
    expect(names).toEqual(["window.json"]);
  });
});

describe("removeOldWebsiteData", () => {
  let root: string;
  let folder: string;
  let marker: string;

  async function names(): Promise<string[]> {
    const found = [];
    for await (const entry of Deno.readDir(folder)) found.push(entry.name);
    return found.sort();
  }

  beforeEach(async () => {
    root = await Deno.makeTempDir({ prefix: "dns-mobileconfig-webkit-" });
    folder = join(root, "WebsiteData", "Default");
    await Deno.mkdir(folder, { recursive: true });
    marker = join(root, "Application Support", "website-data-cleaned");
  });

  afterEach(async () => {
    await Deno.remove(root, { recursive: true });
  });

  it("removes the per-origin folders and keeps WebKit's files", async () => {
    await Deno.mkdir(join(folder, "origin-a", "origin-a", "LocalStorage"), {
      recursive: true,
    });
    await Deno.mkdir(join(folder, "origin-b"));
    await Deno.writeTextFile(join(folder, "salt"), "salt");
    await removeOldWebsiteData(folder, marker);
    expect(await names()).toEqual(["salt"]);
  });

  it("runs only once", async () => {
    await removeOldWebsiteData(folder, marker);
    await Deno.stat(marker);
    await Deno.mkdir(join(folder, "origin-c"));
    await removeOldWebsiteData(folder, marker);
    expect(await names()).toEqual(["origin-c"]);
  });

  it("does nothing when the folder does not exist", async () => {
    await removeOldWebsiteData(join(root, "missing"), marker);
  });
});

describe("parseStoredData", () => {
  it("uses the page's key prefix", () => {
    expect(STORED_KEY_PREFIX).toBe(KEY_PREFIX);
  });

  it("keeps the app's text entries and drops everything else", () => {
    expect(
      parseStoredData({
        "dns-mobileconfig:configs:v1": "[]",
        "dns-mobileconfig:theme": "dark",
        "dns-mobileconfig:count": 3,
        "other-app:key": "value",
      }),
    ).toEqual({
      "dns-mobileconfig:configs:v1": "[]",
      "dns-mobileconfig:theme": "dark",
    });
  });

  it("rejects anything that is not an object of entries", () => {
    for (const value of [null, undefined, "text", 42, ["a"]]) {
      expect(parseStoredData(value)).toBeUndefined();
    }
  });

  it("rejects implausibly large data", () => {
    const huge = "x".repeat(MAX_STORED_BYTES);
    expect(parseStoredData({ "dns-mobileconfig:configs:v1": huge }))
      .toBeUndefined();
  });
});

describe("loading and saving stored data", () => {
  let folder: string;
  let file: string;

  beforeEach(async () => {
    folder = await Deno.makeTempDir({ prefix: "dns-mobileconfig-storage-" });
    file = join(folder, "Application Support", "app.id", "storage.json");
  });

  afterEach(async () => {
    await Deno.remove(folder, { recursive: true });
  });

  it("is empty on first launch", async () => {
    expect(await loadStoredData(file)).toEqual({});
  });

  it("round-trips the entries, replacing earlier ones", async () => {
    await saveStoredData(file, { "dns-mobileconfig:theme": "dark" });
    await saveStoredData(file, { "dns-mobileconfig:configs:v1": "[]" });
    expect(await loadStoredData(file)).toEqual({
      "dns-mobileconfig:configs:v1": "[]",
    });
  });

  it("is empty for a corrupt file, which it sets aside", async () => {
    await saveStoredData(file, { "dns-mobileconfig:theme": "dark" });
    await Deno.writeTextFile(file, "{not json");
    expect(await loadStoredData(file)).toEqual({});
    await expect(Deno.stat(file)).rejects.toThrow(Deno.errors.NotFound);
    const kept = [];
    for await (const entry of Deno.readDir(join(file, ".."))) {
      kept.push(entry.name);
    }
    expect(kept).toHaveLength(1);
    expect(kept[0]).toMatch(/^storage\.corrupt-.+\.json$/);
    expect(await Deno.readTextFile(join(file, "..", kept[0]!))).toBe(
      "{not json",
    );
  });

  it("sets aside a file it would refuse to save", async () => {
    await Deno.mkdir(join(file, ".."), { recursive: true });
    await Deno.writeTextFile(file, '["not", "entries"]');
    expect(await loadStoredData(file)).toEqual({});
    await expect(Deno.stat(file)).rejects.toThrow(Deno.errors.NotFound);
  });

  it("applies overlapping saves in the order they arrive", async () => {
    const save = createStoredDataSaver(file);
    const big = "x".repeat(1024 * 1024);
    await Promise.all([
      save({ "dns-mobileconfig:configs:v1": big }),
      save({ "dns-mobileconfig:configs:v1": "[]" }),
    ]);
    expect(await loadStoredData(file)).toEqual({
      "dns-mobileconfig:configs:v1": "[]",
    });
  });

  it("keeps saving after a refused save", async () => {
    const save = createStoredDataSaver(file);
    const refused = save("not an object");
    const next = save({ "dns-mobileconfig:configs:v1": "[]" });
    await expect(refused).rejects.toThrow(TypeError);
    await next;
    expect(await loadStoredData(file)).toEqual({
      "dns-mobileconfig:configs:v1": "[]",
    });
  });

  it("removes temporary files a crash left, keeping the real ones", async () => {
    await saveStoredData(file, { "dns-mobileconfig:theme": "dark" });
    const leftover = `${file}.1234.tmp`;
    await Deno.writeTextFile(leftover, "{half");
    await removeLeftoverTemporaryFiles(join(file, ".."));
    await expect(Deno.stat(leftover)).rejects.toThrow(Deno.errors.NotFound);
    expect(await loadStoredData(file)).toEqual({
      "dns-mobileconfig:theme": "dark",
    });
  });

  it("refuses to save what it would not load, keeping the file", async () => {
    await saveStoredData(file, { "dns-mobileconfig:theme": "dark" });
    await expect(saveStoredData(file, "not an object")).rejects.toThrow(
      TypeError,
    );
    expect(await loadStoredData(file)).toEqual({
      "dns-mobileconfig:theme": "dark",
    });
  });
});
