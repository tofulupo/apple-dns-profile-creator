/**
 * Deployment settings.
 */

export interface AppConfig {
  /**
   * Shown next to the page heading. Kept in step with `version` in `deno.json`
   * by `test/config.test.ts`, since the browser bundle cannot read that file.
   */
  readonly appVersion: string;

  /**
   * Reverse-DNS namespace for the generated profile's `PayloadIdentifier`.
   */
  readonly identifierPrefix: string;

  /** File name offered when the profile is downloaded. */
  readonly profileFilename: string;

  /**
   * Whether "Use system scope" starts ticked.
   *
   * Required on macOS 26 and later, so it defaults to on.
   */
  readonly systemScopeByDefault: boolean;
}

export const appConfig: AppConfig = {
  appVersion: "3.1.0",
  identifierPrefix: "local.encrypted-dns.",
  profileFilename: "encrypted-dns.mobileconfig",
  systemScopeByDefault: true,
};
