#!/usr/bin/env -S deno run --allow-read --allow-write --allow-run
// Subsets the licensed Söhne webfonts in fonts/source/ to Latin, into
// fonts/subset/, under the names the stylesheet uses. Both folders are kept
// out of git (.git/info/exclude): the licence does not allow publishing the
// files, only shipping them. Run after adding or replacing a font there.
//
// Uses fontTools through uvx, so nothing is installed into the project; the
// first run downloads it.
import { dirname, fromFileUrl, join, resolve } from "@std/path";

const ROOT = resolve(dirname(fromFileUrl(import.meta.url)), "..");
export const FONT_SOURCE = join(ROOT, "fonts", "source");
export const FONT_SUBSET = join(ROOT, "fonts", "subset");

/**
 * The Söhne weights the stylesheet uses, by the weight class each font file
 * declares, and the ASCII names they are served under. Files of any other
 * weight in fonts/source/ are skipped.
 */
export const SOEHNE_FACES: Readonly<Record<number, string>> = {
  400: "Soehne-Buch.woff2",
  500: "Soehne-Kraeftig.woff2",
  600: "Soehne-Halbfett.woff2",
};

/**
 * Google Fonts' "latin" range plus Latin Extended-A, so names in profiles
 * (Łódź, Øresund) still render in Söhne. Anything else falls back to the
 * system font, per character.
 */
export const LATIN_UNICODES = [
  "U+0000-017F",
  "U+0304",
  "U+0308",
  "U+0329",
  "U+02BB-02BC",
  "U+02C6",
  "U+02DA",
  "U+02DC",
  "U+2000-206F",
  "U+20AC",
  "U+2122",
  "U+2191",
  "U+2193",
  "U+2212",
  "U+2215",
  "U+FEFF",
  "U+FFFD",
].join(",");

/**
 * Kept on top of fontTools' defaults (kerning, ligatures, marks and so on):
 * tabular figures, which the stylesheet asks for in the counts.
 */
const EXTRA_FEATURES = ["tnum"];

// Reads each font's own weight and style rather than trusting file names:
// Klim's are lower case and drop the umlaut ("kraftig"). Name records are all
// kept, so the copyright and licence notices stay in the subsets.
const SUBSET_PY = `
import json, os, sys
from fontTools.ttLib import TTFont
from fontTools.subset import Options, Subsetter, parse_unicodes

job = json.loads(sys.argv[1])
results = []
for name in sorted(os.listdir(job["source"])):
    if not name.lower().endswith(".woff2"):
        continue
    path = os.path.join(job["source"], name)
    font = TTFont(path)
    weight = font["OS/2"].usWeightClass
    italic = bool(font["OS/2"].fsSelection & 1)
    target = None if italic else job["faces"].get(str(weight))
    if target is None:
        results.append({"source": name, "weight": weight, "italic": italic})
        continue
    options = Options()
    options.flavor = "woff2"
    options.layout_features += job["features"]
    options.name_IDs = ["*"]
    options.name_languages = ["*"]
    subsetter = Subsetter(options)
    subsetter.populate(unicodes=parse_unicodes(job["unicodes"]))
    subsetter.subset(font)
    out = os.path.join(job["subset"], target)
    font.save(out)
    results.append({"source": name, "weight": weight, "target": target,
                    "before": os.path.getsize(path),
                    "after": os.path.getsize(out)})
print(json.dumps(results))
`;

interface SubsetResult {
  source: string;
  weight: number;
  italic?: boolean;
  target?: string;
  before?: number;
  after?: number;
}

function kilobytes(bytes: number): string {
  return `${(bytes / 1024).toFixed(1)} KB`;
}

async function subsetFonts(): Promise<void> {
  try {
    await Deno.stat(FONT_SOURCE);
  } catch {
    throw new Error(
      "fonts/source/ does not exist. Put the Söhne .woff2 files there first.",
    );
  }
  await Deno.remove(FONT_SUBSET, { recursive: true }).catch(() => {});
  await Deno.mkdir(FONT_SUBSET, { recursive: true });

  const job = JSON.stringify({
    source: FONT_SOURCE,
    subset: FONT_SUBSET,
    faces: SOEHNE_FACES,
    unicodes: LATIN_UNICODES,
    features: EXTRA_FEATURES,
  });
  const { success, stdout } = await new Deno.Command("uvx", {
    args: ["--from", "fonttools[woff]", "python", "-c", SUBSET_PY, job],
    stdout: "piped",
    stderr: "inherit",
  }).output().catch((error) => {
    if (error instanceof Deno.errors.NotFound) {
      throw new Error("uvx not found. Install uv: https://docs.astral.sh/uv/");
    }
    throw error;
  });
  if (!success) throw new Error("Subsetting failed; see the output above.");

  const results = JSON.parse(
    new TextDecoder().decode(stdout),
  ) as SubsetResult[];
  for (const result of results) {
    if (result.target === undefined) {
      console.log(
        `skipped  ${result.source} (weight ${result.weight}${
          result.italic ? ", italic" : ""
        }: not used)`,
      );
    } else {
      console.log(
        `${result.target.padEnd(24)} ${kilobytes(result.before!)} -> ${
          kilobytes(result.after!)
        }  (from ${result.source})`,
      );
    }
  }

  const made = new Set(results.map((result) => result.target));
  const missing = Object.values(SOEHNE_FACES).filter((file) => !made.has(file));
  if (missing.length > 0) {
    throw new Error(
      `No source font for ${missing.join(", ")} in fonts/source/.`,
    );
  }
}

if (import.meta.main) {
  try {
    await subsetFonts();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    Deno.exit(1);
  }
}
