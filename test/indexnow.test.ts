/**
 * IndexNow: the key file the build publishes, the submission the task sends,
 * and that no key ever ends up in the repository.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join, resolve } from "@std/path";
import { walkSync } from "@std/fs/walk";

import { PAGES, SITE_URL } from "../pages/pages.ts";
import { INDEXNOW_KEY_PATTERN, indexNowKeyFile } from "../scripts/build.ts";
import { submission } from "../scripts/indexnow.ts";

const here = import.meta.dirname;
if (here === undefined) throw new Error("Must be loaded from a file URL");
const ROOT = resolve(here, "..");

// Made up for these tests; the real key lives only on Deno Deploy.
const KEY = "0123456789abcdef-test";

describe("indexNowKeyFile", () => {
  it("names the file after the key and holds exactly the key", () => {
    expect(indexNowKeyFile(KEY)).toEqual({ name: `${KEY}.txt`, content: KEY });
  });

  it("rejects keys IndexNow would not accept", () => {
    for (
      const bad of ["short", "has space in it", "slash/in/key", "x".repeat(129)]
    ) {
      expect(() => indexNowKeyFile(bad)).toThrow("INDEXNOW_KEY");
    }
  });
});

describe("submission", () => {
  it("names the host, the key's location and every page", () => {
    expect(submission(KEY)).toEqual({
      host: new URL(SITE_URL).host,
      key: KEY,
      keyLocation: `${SITE_URL}${KEY}.txt`,
      urlList: [SITE_URL, `${SITE_URL}finalize.html`],
    });
    expect(submission(KEY).urlList.length).toBe(PAGES.length);
  });
});

describe("the repository", () => {
  // A committed key file would publish the key through Git as well as the
  // site; it belongs in the Deno Deploy environment only.
  it("contains no IndexNow key file", () => {
    const found: string[] = [];
    for (const dir of ["public", "pages", "src"]) {
      for (const entry of walkSync(join(ROOT, dir), { includeDirs: false })) {
        const stem = entry.name.replace(/\.txt$/, "");
        if (
          entry.name.endsWith(".txt") && INDEXNOW_KEY_PATTERN.test(stem) &&
          Deno.readTextFileSync(entry.path).trim() === stem
        ) {
          found.push(entry.path.slice(ROOT.length + 1));
        }
      }
    }
    expect(found).toEqual([]);
  });
});
