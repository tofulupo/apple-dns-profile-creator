/**
 * The UI layer looks elements up by id and throws at runtime if one is missing.
 * Nothing else in the suite loads the pages, so match the two up statically.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { dirname, join, resolve } from "@std/path";

import { PAGES, SITE_URL } from "../../pages/pages.ts";
import {
  fontPreloads,
  inlineScript,
  pageHref,
  pageUrl,
  presetFeatures,
  presetHost,
  renderPage,
} from "../../scripts/build.ts";
import { THEME_KEY } from "../../src/ui/theme.ts";
import { appConfig } from "../../src/config.ts";

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
      script: `/* page script: ${page.script} */`,
      version: "0.0.0-test",
    }),
  })),
);

describe("inlineScript", () => {
  it("wraps the code in a classic script element", () => {
    expect(inlineScript("init()")).toBe("<script>init()</script>");
  });

  it("refuses code that would end or reparse the element", () => {
    for (const code of ['"</script>"', '"</SCRIPT "', '"<script>"']) {
      expect(() => inlineScript(code)).toThrow();
    }
  });
});

describe("presetHost", () => {
  it("shows a DoH server's host name", () => {
    expect(presetHost({
      name: "Example",
      protocol: "HTTPS",
      serverUrl: "https://doh.example.net/dns-query",
    })).toBe("doh.example.net");
  });

  it("shows a DoT server's host name as it is", () => {
    expect(presetHost({
      name: "Example",
      protocol: "TLS",
      serverUrl: "dot.example.net",
    })).toBe("dot.example.net");
  });
});

describe("presetFeatures", () => {
  it("lists features in menu order, whatever order the preset gives", () => {
    expect(presetFeatures({
      name: "Example",
      protocol: "HTTPS",
      serverUrl: "https://doh.example.net/dns-query",
      features: ["blocking", "ads", "dnssec", "no-logs"],
    })).toEqual(["No logs", "DNSSEC", "Ad blocking", "Malware blocking"]);
  });

  it("is empty without features", () => {
    expect(presetFeatures({
      name: "Example",
      protocol: "TLS",
      serverUrl: "dot.example.net",
    })).toEqual([]);
  });
});

describe("fontPreloads", () => {
  it("preloads Lilex in the desktop app, not Berkeley Mono", async () => {
    const [page] = PAGES;
    if (page === undefined) throw new Error("No pages");
    const html = await renderPage(page, {
      stylesheet: "app.css",
      script: "",
      version: "0.0.0-test",
      desktop: true,
    });
    expect(html).toContain(fontPreloads(true));
    expect(html).toContain('href="fonts/Soehne-Buch.woff2"');
    expect(html).toContain('href="fonts/Lilex-Latin.woff2"');
    expect(html).not.toContain("Berkeley_Mono");
  });

  // Local builds lack the website's licensed fonts.
  it("preloads only fonts the build ships", () => {
    expect(fontPreloads(false, ["Lilex-Latin.woff2"])).toBe("");
    expect(fontPreloads(false, ["Soehne-Buch.woff2"])).toBe(
      `<link rel="preload" href="fonts/Soehne-Buch.woff2" as="font"\n` +
        `      type="font/woff2" crossorigin>`,
    );
  });
});

describe("page titles", () => {
  it("differ between pages", () => {
    const titles = PAGES.map((page) => page.title);
    expect(new Set(titles).size).toBe(titles.length);
  });
});

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

    // A module script runs after parsing, and browsers may paint before
    // that, so whatever it builds from stored data appeared a frame late.
    it("runs its page script inline, after all of the page", () => {
      expect(html).not.toMatch(/<script[^>]*\b(src|type="module")/);
      expect(html).toMatch(
        new RegExp(
          `</div>\\s*<script>/\\* page script: ${page.script} \\*/</script>\\s*</body>`,
        ),
      );
    });

    // The desktop app's fonts (css/app.css) apply through data-app.
    it("marks the desktop app before first paint", () => {
      expect(html).toContain(
        'if ("__TAURI__" in window) document.documentElement.dataset.app = "desktop";',
      );
    });

    it("preloads the website's fonts, which the stylesheet names", () => {
      expect(html).toContain(fontPreloads(false));
      expect(html).not.toContain("Lilex-Latin.woff2");
      const css = Deno.readTextFileSync(join(ROOT, "css", "app.css"));
      for (const file of ["Soehne-Buch.woff2", "Berkeley_Mono.woff2"]) {
        expect(html).toContain(`href="fonts/${file}"`);
        expect(css).toContain(`url("fonts/${file}")`);
      }
    });

    it("applies a saved theme before first paint with the module's key", () => {
      expect(html).toContain(
        `localStorage.getItem(${JSON.stringify(THEME_KEY)})`,
      );
    });

    // Which of these shows depends on the stored list, which only the page
    // script reads. Shown by default, one would flash on every load, such as
    // "No config yet" while there are configurations.
    if (page.file === "finalize.html") {
      it("starts with everything that depends on the list hidden", () => {
        for (const id of ["emptyState", "configList", "downloadPanel"]) {
          const tag = new RegExp(`<[a-z]+[^>]*\\bid="${id}"[^>]*>`).exec(html);
          expect({ id, hidden: /\shidden[\s>]/.test(tag?.[0] ?? "") })
            .toEqual({ id, hidden: true });
        }
      });
    }

    it("renders one preset menu entry per preset, in order", () => {
      const entries = [
        ...html.matchAll(
          /<button type="button" class="preset"[^>]*>(?:<img [^>]*>|<span class="icon[^"]*"[^>]*><\/span>)<span class="preset__head"><span class="preset__name">([^<]*)</g,
        ),
      ].map((match) => match[1]);
      const expected = page.file === "index.html"
        ? appConfig.presets.map((preset) => preset.name)
        : [];
      expect(entries).toEqual(expected);
    });

    if (page.file === "index.html") {
      // Derived from the presets, so editing them does not break the test.
      it("shows each preset's features, protocol and host", () => {
        for (const preset of appConfig.presets) {
          const features = presetFeatures(preset)
            .map((feature) => `<span class="preset__feature">${feature}</span>`)
            .join("");
          const protocol = preset.protocol === "HTTPS" ? "DoH" : "DoT";
          expect(html).toContain(
            `<span class="preset__features">${features}</span></span><span class="preset__server"><span class="preset__protocol">${protocol}</span><span class="preset__host">${
              presetHost(preset)
            }</span></span>`,
          );
        }
      });

      it("names a preset's country to assistive tech, not on screen", () => {
        expect(html).toContain(
          '<span class="preset__name">njal.la<span class="visually-hidden">, Sweden</span></span>',
        );
      });

      it("marks presets with their country's flag, or a globe", () => {
        expect(html).toMatch(
          /<img class="preset__mark preset__flag" src="data:image\/svg\+xml,[^"]+" alt="" title="Sweden"[^>]*><span class="preset__head"><span class="preset__name">njal\.la</,
        );
        expect(html).toContain(
          '<span class="icon icon--globe preset__mark" aria-hidden="true"></span><span class="preset__head"><span class="preset__name">Quad9<',
        );
      });

      // css/app.css puts the tabs between these two on wide screens, through
      // `.page:has(> main > #mainForm)` and a three-row subgrid in <main>.
      it("has the upload zone and the form as <main>'s only children", () => {
        expect(html).toMatch(
          /<main>\s*<div class="field" id="field-fileupload">[\s\S]*<\/div>\s*<form id="mainForm"[\s\S]*<\/form>\s*<\/main>/,
        );
      });

      it("starts with the preset menu closed", () => {
        expect(html).toMatch(
          /<ul class="preset-menu" id="presetMenu"[^>]*hidden>/,
        );
        expect(html).toContain(
          'aria-expanded="false" aria-controls="presetMenu"',
        );
      });
    }

    it("has its own title, canonical URL and Open Graph tags", () => {
      const url = pageUrl(page);
      expect(html).toContain(`<title>${page.title}</title>`);
      expect(html).toContain(`<link rel="canonical" href="${url}">`);
      expect(html).toContain(`<meta property="og:url" content="${url}">`);
      expect(html).toContain(
        `<meta property="og:title" content="${page.title}">`,
      );
    });

    it("embeds JSON-LD that parses and points at the deployed site", () => {
      const match = html.match(
        /<script type="application\/ld\+json">([^<]*)<\/script>/,
      );
      expect(match?.[1]).toBeDefined();
      const data = JSON.parse(match?.[1] ?? "");
      expect(data["@type"]).toBe("WebApplication");
      expect(data.url).toBe(SITE_URL);
      expect(data.softwareVersion).toBe("0.0.0-test");
      expect(typeof data.description).toBe("string");
    });

    it("marks only its own tab as current", () => {
      const current = [
        ...html.matchAll(/<a href="([^"]+)"[^>]*aria-current="page"/g),
      ].map((match) => match[1]);
      expect(current).toEqual([pageHref(page)]);
    });

    // On phones and tablets the dock is the floating bottom bar
    // (css/app.css): the tabs first, then the theme switch and version, which
    // stay outside the navigation landmark.
    it("groups the tabs, theme switch and version in the dock", () => {
      const dock = html.match(
        /<div class="dock">\s*<nav class="tabs" aria-label="Pages">([\s\S]*?)<\/nav>\s*<div class="site-header__actions">([\s\S]*?)<\/div>\s*<\/div>/,
      );
      expect(dock).not.toBeNull();
      const [, tabs = "", extras = ""] = dock ?? [];
      expect([...tabs.matchAll(/class="tab"/g)].length).toBe(PAGES.length);
      expect(extras).toContain('id="themeSwitch"');
      expect(extras).toContain(">v0.0.0-test</a>");
    });

    // Hidden visually on phones, where the bar shows only the icons; the
    // label stays the tab's accessible name.
    it("wraps each tab's label, which the bar can hide", () => {
      for (const page of PAGES) {
        expect(html).toContain(`<span class="tab__label">${page.nav}</span>`);
      }
    });

    it("tells that the version opens the source in a new tab", () => {
      expect(html).toMatch(
        /<a class="version"[^>]*target="_blank"[^>]*aria-label="v0\.0\.0-test, source code on GitHub, opens in a new tab"><span\s+class="icon icon--source" aria-hidden="true"><\/span>v0\.0\.0-test<\/a>/,
      );
    });

    it("keeps the header to the lockup", () => {
      const header = html.match(
        /<header class="site-header">([\s\S]*?)<\/header>/,
      );
      expect(header?.[1]).toContain('class="brand"');
      expect(header?.[1]).not.toContain("themeSwitch");
    });

    // The bar keeps clear of the home indicator with env(safe-area-inset-*),
    // which is zero without it.
    it("lets the page run to the screen's edges", () => {
      expect(html).toMatch(
        /<meta name="viewport"\s+content="[^"]*viewport-fit=cover[^"]*">/,
      );
    });

    it("links the start page by its canonical address, not index.html", () => {
      expect(html).not.toMatch(/href="(?:\.\/)?index\.html"/);
    });
  });
}
