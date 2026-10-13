export interface Page {
  readonly file: string;
  readonly nav: string;
  readonly title: string;
  /** The `icon--<name>` class in `css/app.css`. */
  readonly icon: string;
  readonly countId?: string;
  readonly description: string;
  readonly script: string;
  readonly priority: number;
}

export const SITE_URL = "https://mobileconfig.io/";

/** The website's version. The desktop app's is in deno.json. */
export const SITE_VERSION = "3.17.2";

export const PAGES: readonly Page[] = [
  {
    file: "index.html",
    nav: "Tool",
    title: "DNS Profile Creator – encrypted DNS profiles for iOS and macOS",
    icon: "upload",
    description:
      "Build encrypted DNS (DoH and DoT) configuration profiles for iOS and macOS in your browser, or switch the resolver of a profile you have and keep its rules.",
    script: "src/ui/tool.ts",
    priority: 1.0,
  },
  {
    file: "finalize.html",
    nav: "Profile",
    title: "Download profile – DNS Profile Creator",
    icon: "profile",
    countId: "profileCount",
    description:
      "Review your encrypted DNS configurations and download the finished configuration profile.",
    script: "src/ui/profile.ts",
    priority: 0.8,
  },
];
