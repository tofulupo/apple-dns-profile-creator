/**
 * The site's pages, in navigation order.
 *
 * Each page's content lives in `pages/<file>` and is rendered into
 * `pages/_layout.html` by `scripts/build.ts`, which also derives the tab bar
 * and `sitemap.xml` from this table.
 */

export interface Page {
  /** Content fragment in `pages/`, and the file name it is published under. */
  readonly file: string;
  /** Label of the page's tab. */
  readonly nav: string;
  /** Tab icon: the `icon--<name>` class in `css/app.css`. */
  readonly icon: string;
  /** `<meta name="description">` text. */
  readonly description: string;
  /** Entry module, relative to the project root. */
  readonly script: string;
  /** Sitemap priority, 0.0 to 1.0. */
  readonly priority: number;
}

/** Public URL of the deployed site, for the sitemap. Ends with a slash. */
export const SITE_URL = "https://tofulupo.github.io/apple-dns-profile-creator/";

export const PAGES: readonly Page[] = [
  {
    file: "index.html",
    nav: "Tool",
    icon: "upload",
    description:
      "Build encrypted DNS (DoH and DoT) configuration profiles for iOS and macOS, entirely in your browser.",
    script: "src/ui/tool.ts",
    priority: 1.0,
  },
  {
    file: "finalize.html",
    nav: "Profile",
    icon: "profile",
    description:
      "Review your encrypted DNS configurations and download the finished configuration profile.",
    script: "src/ui/profile.ts",
    priority: 0.8,
  },
];
