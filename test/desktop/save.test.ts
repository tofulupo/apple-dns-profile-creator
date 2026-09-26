/**
 * Tests for how the desktop app names and writes saved profiles.
 */
import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join } from "@std/path";

import {
  numberedFilename,
  profileFilename,
  saveWithoutOverwrite,
} from "../../src/desktop/save.ts";

describe("profileFilename", () => {
  it("keeps a plain name that already has the extension", () => {
    expect(profileFilename("encrypted-dns.mobileconfig")).toBe(
      "encrypted-dns.mobileconfig",
    );
  });

  it("adds the extension, whatever the case of an existing one", () => {
    expect(profileFilename("quad9")).toBe("quad9.mobileconfig");
    expect(profileFilename("quad9.MobileConfig")).toBe("quad9.mobileconfig");
  });

  it("drops any folder part, so the page cannot pick the location", () => {
    expect(profileFilename("../../.ssh/authorized_keys")).toBe(
      "authorized_keys.mobileconfig",
    );
    expect(profileFilename("/etc/x.mobileconfig")).toBe("x.mobileconfig");
    expect(profileFilename("C:\\Users\\x.mobileconfig")).toBe(
      "x.mobileconfig",
    );
  });

  it("removes characters macOS file names cannot hold, and leading dots", () => {
    expect(profileFilename("a:b\u0000c\u001Fd")).toBe("abcd.mobileconfig");
    expect(profileFilename("..hidden")).toBe("hidden.mobileconfig");
  });

  it("falls back to a default for a name with nothing left", () => {
    for (const name of ["", "   ", ".mobileconfig", "/", "..", "::"]) {
      expect(profileFilename(name)).toBe("profile.mobileconfig");
    }
  });

  it("keeps spaces and non-ASCII text inside the name", () => {
    expect(profileFilename("Mein Profil ü.mobileconfig")).toBe(
      "Mein Profil ü.mobileconfig",
    );
  });
});

describe("numberedFilename", () => {
  it("numbers copies the way Finder does", () => {
    const name = "encrypted-dns.mobileconfig";
    expect(numberedFilename(name, 1)).toBe(name);
    expect(numberedFilename(name, 2)).toBe("encrypted-dns 2.mobileconfig");
    expect(numberedFilename(name, 10)).toBe("encrypted-dns 10.mobileconfig");
  });
});

describe("saveWithoutOverwrite", () => {
  let folder: string;

  beforeEach(async () => {
    folder = await Deno.makeTempDir({ prefix: "dns-mobileconfig-save-" });
  });

  afterEach(async () => {
    await Deno.remove(folder, { recursive: true });
  });

  it("writes the contents under the requested name", async () => {
    const path = await saveWithoutOverwrite(folder, "a.mobileconfig", "<x/>");
    expect(path).toBe(join(folder, "a.mobileconfig"));
    expect(await Deno.readTextFile(path)).toBe("<x/>");
  });

  it("never replaces an existing file, numbering new ones instead", async () => {
    await Deno.writeTextFile(join(folder, "a.mobileconfig"), "original");
    const second = await saveWithoutOverwrite(folder, "a.mobileconfig", "2");
    const third = await saveWithoutOverwrite(folder, "a.mobileconfig", "3");

    expect(second).toBe(join(folder, "a 2.mobileconfig"));
    expect(third).toBe(join(folder, "a 3.mobileconfig"));
    expect(await Deno.readTextFile(join(folder, "a.mobileconfig"))).toBe(
      "original",
    );
    expect(await Deno.readTextFile(third)).toBe("3");
  });

  it("creates the folder when it does not exist", async () => {
    const missing = join(folder, "Downloads");
    const path = await saveWithoutOverwrite(missing, "a", "<x/>");
    expect(path).toBe(join(missing, "a.mobileconfig"));
  });

  it("stays inside the folder whatever name it is given", async () => {
    const path = await saveWithoutOverwrite(folder, "../escape", "<x/>");
    expect(path).toBe(join(folder, "escape.mobileconfig"));
  });
});
