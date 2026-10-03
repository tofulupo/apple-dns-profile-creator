// Söhne and Berkeley Mono are licensed for the website only: they may be
// served, not published in the repository.
import { AwsClient } from "aws4fetch";
import { join } from "@std/path";

import { SOEHNE_FACES } from "./fonts.ts";

/** Named the same in the bucket. */
export const BERKELEY_MONO = "Berkeley_Mono.woff2";

export const WEB_FONTS: readonly string[] = [
  ...Object.values(SOEHNE_FACES),
  BERKELEY_MONO,
];

/** Must match the Build-context variables on Deno Deploy. */
export const R2_ENV = {
  endpoint: "R2_ENDPOINT",
  accountId: "R2_ACCOUNT_ID",
  bucket: "R2_BUCKET",
  accessKeyId: "R2_ACCESS_KEY_ID",
  secretAccessKey: "R2_SECRET_ACCESS_KEY",
} as const;

export interface R2Config {
  readonly endpoint: string;
  readonly bucket: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
}

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

export function objectUrl(config: R2Config, name: string): string {
  return `${config.endpoint}/${encodeURIComponent(config.bucket)}/${
    encodeURIComponent(name)
  }`;
}

export function isWoff2(bytes: Uint8Array): boolean {
  return new TextDecoder().decode(bytes.subarray(0, 4)) === "wOF2";
}

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
