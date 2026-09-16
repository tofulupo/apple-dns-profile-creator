/**
 * The UI layer looks elements up by id and throws at runtime if one is missing.
 * Nothing else in the suite loads the pages, so match the two up statically.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join, resolve } from "@std/path";

const here = import.meta.dirname;
if (here === undefined) {
  throw new Error("Markup test must be loaded from a file URL");
}
const ROOT = resolve(here, "..", "..");

function referencedIds(module: string): string[] {
  const source = Deno.readTextFileSync(join(ROOT, "src", "ui", module));
  const ids = [
    ...source.matchAll(
      /\b(?:element|input|textarea)(?:<[^>()]*>)?\(\s*"([^"]+)"/g,
    ),
  ]
    .map((match) => match[1])
    .filter((id): id is string => id !== undefined);
  return [...new Set(ids)].sort();
}

function declaredIds(page: string): Set<string> {
  const source = Deno.readTextFileSync(join(ROOT, page));
  return new Set(
    [...source.matchAll(/\bid="([^"]+)"/g)]
      .map((match) => match[1])
      .filter((id): id is string => id !== undefined),
  );
}

const pages = [
  ["tool.ts", "index.html"],
  ["profile.ts", "finalize.html"],
] as const;

for (const [module, page] of pages) {
  describe(`${module} against ${page}`, () => {
    const declared = declaredIds(page);
    const referenced = referencedIds(module);

    it("references at least one element", () => {
      expect(referenced.length).toBeGreaterThan(0);
    });

    for (const id of referenced) {
      it(`finds #${id}`, () => {
        expect(declared.has(id)).toBe(true);
      });
    }
  });
}
