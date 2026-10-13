import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { dirname, join, resolve } from "@std/path";

import { PAGES, SITE_URL } from "../../pages/pages.ts";
import {
  fontPreloads,
  pageHref,
  pageUrl,
  presetHost,
  renderNotFound,
  renderPage,
  renderSettings,
  scriptTag,
} from "../../scripts/build.ts";
import { THEME_KEY } from "../../src/ui/theme.ts";
import { PIXEL_KEY } from "../../src/ui/pixel.ts";
import { SETTINGS_KEY } from "../../src/ui/settings.ts";
import { appConfig, presetFeatures } from "../../src/config.ts";

const here = import.meta.dirname;
if (here === undefined) {
  throw new Error("Markup test must be loaded from a file URL");
}
const ROOT = resolve(here, "..", "..");
const PREPAINT = Deno.readTextFileSync(join(ROOT, "pages", "_prepaint.js"));

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
      prepaint: "./app-prepaint.js",
      script: `./app-${page.file}.js`,
      version: "0.0.0-test",
    }),
  })),
);

describe("scriptTag", () => {
  it("loads a classic script from its own file", () => {
    expect(scriptTag("./app-0123abcd.js")).toBe(
      '<script src="./app-0123abcd.js"></script>',
    );
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

describe("fontPreloads", () => {
  it("preloads Lilex in the desktop app, not Berkeley Mono", async () => {
    const [page] = PAGES;
    if (page === undefined) throw new Error("No pages");
    const html = await renderPage(page, {
      stylesheet: "app.css",
      prepaint: "",
      script: "",
      version: "0.0.0-test",
      desktop: true,
    });
    expect(html).toContain(fontPreloads(true));
    expect(html).toContain('href="fonts/Soehne-Buch.woff2"');
    expect(html).toContain('href="fonts/Lilex-Latin.woff2"');
    expect(html).not.toContain("Berkeley_Mono");
  });

  it("preloads only fonts the build ships", () => {
    expect(fontPreloads(false, ["Lilex-Latin.woff2"])).toBe("");
    expect(fontPreloads(false, ["Soehne-Buch.woff2"])).toBe(
      `<link rel="preload" href="fonts/Soehne-Buch.woff2" as="font"\n` +
        `      type="font/woff2" crossorigin>`,
    );
  });
});

describe("the mascot", () => {
  it("stands in front of the name on the website and in the app", async () => {
    for (const desktop of [false, true]) {
      for (const page of PAGES) {
        const html = await renderPage(page, {
          stylesheet: "app.css",
          prepaint: "",
          script: "",
          version: "0.0.0-test",
          desktop,
        });
        const brand = html.match(/<div class="brand">([\s\S]*?)<h1/)?.[1];
        expect({ page: page.file, desktop, brand }).toMatchObject({
          brand: expect.stringContaining(
            '<span class="brand__mascot" aria-hidden="true">',
          ),
        });
      }
    }
  });
});

describe("the Privacy pill", () => {
  it("is on every website page, with its popover and the version at the end", () => {
    for (const { html } of rendered) {
      expect(html).toContain('id="keepPill"');
      expect(html).toContain('popovertarget="keepPanel"');
      expect(html).toContain(
        '<div class="keep-panel" id="keepPanel" popover>',
      );
      expect(html).toContain('<footer class="page-end">');
    }
  });

  // Annoyance filter lists in ad blockers (uBlock Origin's Fanboy list) hide
  // elements by such words in their class or id.
  it("has no class or id an ad blocker's annoyance list would hide", () => {
    const names = rendered.flatMap(({ html }) =>
      [...html.matchAll(/\s(?:class|id)="([^"]*)"/g)].map((match) => match[1]!)
    );
    expect(
      names.filter((name) =>
        /privacy|cookie|consent|gdpr|banner|popup|newsletter|subscribe/i.test(
          name,
        )
      ),
    ).toEqual([]);
  });

  it("is left out of the desktop app, which forgets on quit in Settings", async () => {
    for (const page of PAGES) {
      const html = await renderPage(page, {
        stylesheet: "app.css",
        prepaint: "./app-prepaint.js",
        script: "./app-script.js",
        version: "0.0.0-test",
        desktop: true,
      });
      expect(html).not.toContain("keepPill");
      expect(html).not.toContain("page-end");
    }
  });
});

describe("the font profile panel", () => {
  it("is in the desktop app's profile page", async () => {
    const page = PAGES.find((p) => p.file === "finalize.html");
    if (page === undefined) throw new Error("No profile page");
    const html = await renderPage(page, {
      stylesheet: "app.css",
      prepaint: "",
      script: "",
      version: "0.0.0-test",
      desktop: true,
    });
    for (const id of ["fontPanel", "fontFile", "fontCount", "fontHash"]) {
      expect(html).toContain(`id="${id}"`);
    }
  });

  it("is left out of the website", () => {
    for (const { html } of rendered) {
      expect(html.toLowerCase()).not.toContain("font profile");
      expect(html).not.toContain('id="fontPanel"');
    }
  });
});

const settingsHtml = await renderSettings({
  stylesheet: "app.css",
  prepaint: "./app-prepaint.js",
  script: "./app-settings.js",
  version: "0.0.0-test",
});

describe("the Settings window", () => {
  const html = settingsHtml;
  const values = (name: string) =>
    [...html.matchAll(new RegExp(`name="${name}" value="(\\w+)"`, "g"))]
      .map((match) => match[1]);

  it("fills every placeholder", () => {
    expect(html).not.toMatch(/\{\{/);
  });

  it("applies the theme and reduced motion before first paint", () => {
    expect(html).toMatch(
      /<\/title>[\s\S]*<script src="\.\/app-prepaint\.js"><\/script>[\s\S]*<\/head>/,
    );
    expect(PREPAINT).toContain(`stored(${JSON.stringify(THEME_KEY)})`);
    expect(PREPAINT).toContain(`stored(${JSON.stringify(SETTINGS_KEY)})`);
  });

  it("offers each theme and motion, as the modules name them", () => {
    expect(values("theme")).toEqual(["system", "light", "dark"]);
    expect(values("motion")).toEqual(["system", "reduce", "full"]);
  });

  it("has the version, which opens its release notes in a new tab", () => {
    expect(html).toMatch(
      /<a class="version"\s+href="https:\/\/github\.com\/tofulupo\/apple-dns-profile-creator\/blob\/v0\.0\.0-test\/CHANGELOG\.md"[^>]*target="_blank"[^>]*aria-label="v0\.0\.0-test, release notes on GitHub, opens in a new tab"><span\s+class="icon icon--source" aria-hidden="true"><\/span>/,
    );
  });

  it("preloads the app's fonts, not the website's", () => {
    expect(html).toContain(fontPreloads(true));
    expect(html).not.toContain("Berkeley_Mono");
  });
});

const notFoundHtml = await renderNotFound({
  stylesheet: "/app-0123abcd.css",
  prepaint: "/app-prepaint.js",
});

describe("the 404 page", () => {
  const html = notFoundHtml;

  it("fills every placeholder", () => {
    expect(html).not.toContain("{{");
  });

  it("says what happened and leads back to the tool", () => {
    expect(html).toContain('<p class="not-found__status">404 · NXDOMAIN</p>');
    expect(html).toContain('<h1 id="notFoundTitle">Page not found</h1>');
    expect(html).toContain(
      "<p>This address doesn't resolve to anything here.</p>",
    );
    const links = [...html.matchAll(/<a [^>]*href="([^"]*)"[^>]*>([^<]*)</g)]
      .map((match) => [match[1], match[2]]);
    expect(links).toEqual([["/", "Go to the tool"]]);
  });

  it("loads everything from the site root", () => {
    const paths = [...html.matchAll(/\s(?:href|src)="([^"]*)"/g)]
      .map((match) => match[1]);
    expect(paths.length).toBeGreaterThan(5);
    for (const path of paths) expect(path).toMatch(/^\/(?!\/)/);
    expect(html).toContain(fontPreloads(false, undefined, "/"));
  });

  it("is kept out of search, with no canonical URL or page data", () => {
    expect(html).toContain('<meta name="robots" content="noindex">');
    expect(html).not.toContain('rel="canonical"');
    expect(html).not.toContain("og:");
    expect(html).not.toContain("application/ld+json");
  });

  it("runs nothing but the prepaint script, from a file", () => {
    expect([...html.matchAll(/<script[^>]*>/g)].map((match) => match[0]))
      .toEqual(['<script src="/app-prepaint.js">']);
  });

  it("has the mascot peeking over the card, paws on its edge", () => {
    expect(html).toMatch(
      /<div class="not-found__peek" aria-hidden="true">\s*(?:<!--[\s\S]*?-->\s*)?<span class="brand__mascot"[\s\S]*<span class="not-found__paws"><\/span>\s*<\/div>\s*<section class="panel not-found__card"/,
    );
  });

  it("leaves out the tabs, the Privacy pill and the theme switch", () => {
    for (const part of ['class="tabs"', "keepPill", "themeSwitch"]) {
      expect(html).not.toContain(part);
    }
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

    it("loads its scripts from its own files, the page script after all of the page", () => {
      expect(html).not.toMatch(/<script>|<script[^>]*type="module"/);
      expect(html).toContain('<script src="./app-prepaint.js"></script>');
      expect(html).toMatch(
        new RegExp(
          `</div>\\s*<script src="\\./app-${page.file}\\.js"></script>\\s*</body>`,
        ),
      );
    });

    it("marks the desktop app before first paint", () => {
      expect(PREPAINT).toContain(
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
      expect(PREPAINT).toContain(`stored(${JSON.stringify(THEME_KEY)})`);
    });

    it("reads the tab's storage first before first paint, then the browser's", () => {
      expect(PREPAINT).toContain(
        "sessionStorage.getItem(key) ?? localStorage.getItem(key)",
      );
    });

    it("applies reduced motion before first paint with the module's key", () => {
      expect(PREPAINT).toContain(`stored(${JSON.stringify(SETTINGS_KEY)})`);
    });

    it("keeps the app's pixel font from page to page with the module's key", () => {
      expect(PREPAINT).toContain(
        `sessionStorage.getItem(${JSON.stringify(PIXEL_KEY)}) === "on"`,
      );
    });

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
          /<main>\s*<div class="field zone-field" id="field-fileupload">[\s\S]*<\/div>\s*<form id="mainForm"[\s\S]*<\/form>\s*<\/main>/,
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

    // The tabs' <nav> first, then the theme switch and version outside it.
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

    // css/app.css pads the bar with env(safe-area-inset-*), zero without it.
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
