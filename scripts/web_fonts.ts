/**
 * The website's licensed fonts: Söhne for its text and Berkeley Mono for its
 * monospace. Neither may be published in the repository, only served, so
 * they live in a private Cloudflare R2 bucket, uploaded by hand, and the
 * website's build downloads them into dist/fonts/. They then come from the
 * site's own address like any other file.
 *
 * On Deno Deploy, the bucket's S3 credentials are Build-context variables
 * (R2_ENV), used only while building. Local and CI builds have none, and use
 * the system font.
 * The desktop app's build never reads the bucket.
 */
import { AwsClient } from "aws4fetch";
import { join } from "@std/path";

import { SOEHNE_FACES } from "./fonts.ts";

/** The variable Berkeley Mono, as served and as named in the bucket. */
export const BERKELEY_MONO = "Berkeley_Mono.woff2";

/** Every font the website serves, by the names the stylesheet uses. */
export const WEB_FONTS: readonly string[] = [
  ...Object.values(SOEHNE_FACES),
  BERKELEY_MONO,
];

/**
 * The Build-context variables on Deno Deploy. The endpoint may be given
 * outright or as the account it belongs to; if both are set, the endpoint
 * wins.
 */
export const R2_ENV = {
  endpoint: "R2_ENDPOINT",
  accountId: "R2_ACCOUNT_ID",
  bucket: "R2_BUCKET",
  accessKeyId: "R2_ACCESS_KEY_ID",
  secretAccessKey: "R2_SECRET_ACCESS_KEY",
} as const;

export interface R2Config {
  /** The account's S3 endpoint, without a path. */
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

/**
 * The bucket's settings from `env`, or undefined when none are set. Some but
 * not all of them is a mistake in the deployment's settings, and so is an
 * endpoint that is not R2's: the build may only reach *.r2.cloudflarestorage.com.
 * An endpoint copied with the bucket on the end, as Cloudflare's dashboard
 * shows it, is taken without it.
 */
export function r2Config(
  env: (name: string) => string | undefined,
): R2Config | undefined {
  const read = (name: string): string | undefined => {
    const value = env(name)?.trim();
    return value === "" ? undefined : value;
  };
  const values = {
    endpoint: read(R2_ENV.endpoint),
    accountId: read(R2_ENV.accountId),
    bucket: read(R2_ENV.bucket),
    accessKeyId: read(R2_ENV.accessKeyId),
    secretAccessKey: read(R2_ENV.secretAccessKey),
  };
  if (Object.values(values).every((value) => value === undefined)) {
    return undefined;
  }
  const missing = [
    ...(values.endpoint === undefined && values.accountId === undefined
      ? [`${R2_ENV.endpoint} or ${R2_ENV.accountId}`]
      : []),
    ...(["bucket", "accessKeyId", "secretAccessKey"] as const)
      .filter((key) => values[key] === undefined)
      .map((key) => R2_ENV[key]),
  ];
  if (missing.length > 0) {
    throw new Error(`R2 settings incomplete, missing: ${missing.join(", ")}`);
  }
  const endpoint = new URL(
    values.endpoint ?? `https://${values.accountId}.r2.cloudflarestorage.com`,
  );
  if (
    endpoint.protocol !== "https:" ||
    !endpoint.hostname.endsWith(".r2.cloudflarestorage.com")
  ) {
    throw new Error(
      `${R2_ENV.endpoint} must be the account's S3 endpoint, ` +
        "https://<account id>.r2.cloudflarestorage.com",
    );
  }
  const path = endpoint.pathname.replace(/\/+$/, "");
  if (path !== "" && path !== `/${values.bucket}`) {
    throw new Error(`${R2_ENV.endpoint} has an unexpected path: ${path}`);
  }
  return {
    endpoint: endpoint.origin,
    bucket: values.bucket!,
    accessKeyId: values.accessKeyId!,
    secretAccessKey: values.secretAccessKey!,
  };
}

/** Where `name` lies in the bucket, as an S3 path-style URL. */
export function objectUrl(config: R2Config, name: string): string {
  return `${config.endpoint}/${encodeURIComponent(config.bucket)}/${
    encodeURIComponent(name)
  }`;
}

/** Whether `bytes` start like a WOFF2 file, rather than an error page. */
export function isWoff2(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, 4)) === "wOF2";
}

/** Downloads `names` from the bucket into `to`. Any failure throws. */
export async function downloadFonts(
  config: R2Config,
  names: readonly string[],
  to: string,
): Promise<string[]> {
  const client = new AwsClient({
    accessKeyId: config.accessKeyId,
    secretAccessKey: config.secretAccessKey,
    service: "s3",
    region: "auto",
  });
  await Deno.mkdir(to, { recursive: true });
  for (const name of names) {
    const response = await client.fetch(objectUrl(config, name));
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`R2: ${name}: ${response.status} ${response.statusText}`);
    }
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (!isWoff2(bytes)) throw new Error(`R2: ${name} is not a WOFF2 file`);
    await Deno.writeFile(join(to, name), bytes);
  }
  return [...names].sort();
}
