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

export const SITE_URL = "https://apple.mobileconfig.deno.net/";

export const PAGES: readonly Page[] = [
  {
    file: "index.html",
    nav: "Tool",
    title: "DNS Profile Creator – encrypted DNS profiles for iOS and macOS",
    icon: "upload",
    description:
      "Build encrypted DNS (DoH and DoT) configuration profiles for iOS and macOS, entirely in your browser.",
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
