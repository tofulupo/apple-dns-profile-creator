/**
 * The UI layer looks elements up by id and throws at runtime if one is missing.
 * Nothing else in the suite loads the pages, so match the two up statically.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { dirname, join, resolve } from "@std/path";

import { PAGES } from "../../pages/pages.ts";
import { renderPage } from "../../scripts/build.ts";
import { THEME_KEY } from "../../src/ui/theme.ts";

const here = import.meta.dirname;
if (here === undefined) {
  throw new Error("Markup test must be loaded from a file URL");
}
const ROOT = resolve(here, "..", "..");

/**
 * Ids the entry module looks up, including in the sibling UI modules it
 * imports directly, such as `signing.ts` on the profile page.
 */
function referencedIds(module: string): string[] {
  const entry = Deno.readTextFileSync(join(ROOT, module));
  const siblings = [...entry.matchAll(/from "\.\/(\w+\.ts)"/g)]
    .map((match) => match[1])
    .filter((file): file is string => file !== undefined)
    .map((file) => Deno.readTextFileSync(join(ROOT, dirname(module), file)));

  const ids = [entry, ...siblings].flatMap((source) =>
    [
      ...source.matchAll(
        /\b(?:element|input|textarea)(?:<[^>()]*>)?\(\s*"([^"]+)"/g,
      ),
    ]
      .map((match) => match[1])
      .filter((id): id is string => id !== undefined)
  );
  return [...new Set(ids)].sort();
}

function declaredIds(html: string): Set<string> {
  return new Set(
    [...html.matchAll(/\bid="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((id): id is string => id !== undefined),
  );
}

const rendered = await Promise.all(
  PAGES.map(async (page) => ({
    page,
    html: await renderPage(page, {
      stylesheet: "app.css",
      script: page.script,
      version: "0.0.0-test",
    }),
  })),
);

for (const { page, html } of rendered) {
  describe(`${page.script} against ${page.file}`, () => {
    const declared = declaredIds(html);
    const referenced = referencedIds(page.script);

    it("references at least one element", () => {
      expect(referenced.length).toBeGreaterThan(0);
    });

    for (const id of referenced) {
      it(`finds #${id}`, () => {
        expect(declared.has(id)).toBe(true);
      });
    }
  });

  describe(`rendered ${page.file}`, () => {
    it("fills every placeholder", () => {
      expect(html).not.toContain("{{");
      expect(html).toContain(">v0.0.0-test</a>");
    });

    it("applies a saved theme before first paint with the module's key", () => {
      expect(html).toContain(
        `localStorage.getItem(${JSON.stringify(THEME_KEY)})`,
      );
    });

    it("marks only its own tab as current", () => {
      const current = [
        ...html.matchAll(/<a href="([^"]+)"[^>]*aria-current="page"/g),
      ].map((match) => match[1]);
      expect(current).toEqual([page.file]);
    });
  });
}
