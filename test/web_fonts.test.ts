import { afterEach, beforeEach, describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";
import { join } from "@std/path";

import { stub } from "@std/testing/mock";

import {
  BERKELEY_MONO,
  downloadFonts,
  isWoff2,
  objectUrl,
  R2_ENV,
  r2Config,
  WEB_FONTS,
} from "../scripts/web_fonts.ts";

const ENDPOINT = "https://0123abcd.r2.cloudflarestorage.com";

function env(values: Record<string, string>) {
  return (name: string) => values[name];
}

const complete = {
  [R2_ENV.endpoint]: ENDPOINT,
  [R2_ENV.bucket]: "fonts",
  [R2_ENV.accessKeyId]: "id",
  [R2_ENV.secretAccessKey]: "secret",
};

describe("r2Config", () => {
  it("is undefined without any of the settings, as locally and on CI", () => {
    expect(r2Config(env({}))).toBeUndefined();
    expect(r2Config(env({ [R2_ENV.bucket]: " " }))).toBeUndefined();
  });

  const expected = {
    endpoint: ENDPOINT,
    bucket: "fonts",
    accessKeyId: "id",
    secretAccessKey: "secret",
  };

  it("reads the settings with the endpoint", () => {
    expect(r2Config(env(complete))).toEqual(expected);
  });

  it("makes the endpoint from the account when that is all it has", () => {
    const { [R2_ENV.endpoint]: _, ...rest } = complete;
    expect(r2Config(env({ ...rest, [R2_ENV.accountId]: "0123abcd" })))
      .toEqual(expected);
  });

  it("takes an endpoint with the bucket on the end", () => {
    expect(
      r2Config(env({ ...complete, [R2_ENV.endpoint]: `${ENDPOINT}/fonts/` })),
    ).toEqual(expected);
    expect(() =>
      r2Config(env({ ...complete, [R2_ENV.endpoint]: `${ENDPOINT}/other` }))
    ).toThrow("unexpected path");
  });

  it("names what is missing when only some are set", () => {
    const { [R2_ENV.secretAccessKey]: _, ...partial } = complete;
    expect(() => r2Config(env(partial))).toThrow(R2_ENV.secretAccessKey);
    const { [R2_ENV.endpoint]: __, ...noEndpoint } = complete;
    expect(() => r2Config(env(noEndpoint))).toThrow(R2_ENV.accountId);
  });

  // The build may only reach R2's hosts (deno.json's --allow-net).
  it("refuses an endpoint that is not R2's over https", () => {
    for (
      const endpoint of [
        "http://0123abcd.r2.cloudflarestorage.com",
        "https://example.com",
        "https://r2.cloudflarestorage.com.example.com",
      ]
    ) {
      expect(() => r2Config(env({ ...complete, [R2_ENV.endpoint]: endpoint })))
        .toThrow(R2_ENV.endpoint);
    }
  });
});

describe("objectUrl", () => {
  it("addresses the file in the bucket, path style", () => {
    const config = r2Config(
      env({ ...complete, [R2_ENV.endpoint]: `${ENDPOINT}/` }),
    )!;
    expect(objectUrl(config, BERKELEY_MONO)).toBe(
      `${ENDPOINT}/fonts/${BERKELEY_MONO}`,
    );
  });
});

describe("isWoff2", () => {
  it("knows a WOFF2 file from an error page", () => {
    expect(isWoff2(new TextEncoder().encode("wOF2\0\x01"))).toBe(true);
    expect(isWoff2(new TextEncoder().encode("<?xml version"))).toBe(false);
  });
});

describe("the website's fonts", () => {
  it("are Söhne's three weights and Berkeley Mono", () => {
    expect([...WEB_FONTS].sort()).toEqual([
      BERKELEY_MONO,
      "Soehne-Buch.woff2",
      "Soehne-Halbfett.woff2",
      "Soehne-Kraeftig.woff2",
    ]);
  });
});

describe("downloadFonts", () => {
  const config = r2Config(env(complete))!;
  let to: string;

  beforeEach(async () => {
    to = join(await Deno.makeTempDir({ prefix: "dns-fonts-r2-" }), "fonts");
  });

  afterEach(async () => {
    await Deno.remove(join(to, ".."), { recursive: true });
  });

  it("fetches each file, signed for R2's S3 API, into the build", async () => {
    const requests: Request[] = [];
    using _fetch = stub(globalThis, "fetch", (input) => {
      requests.push(input as Request);
      return Promise.resolve(new Response("wOF2 font"));
    });

    expect(await downloadFonts(config, [BERKELEY_MONO], to)).toEqual([
      BERKELEY_MONO,
    ]);
    expect(requests.map((request) => request.url)).toEqual([
      `${ENDPOINT}/fonts/${BERKELEY_MONO}`,
    ]);
    const authorization = requests[0]?.headers.get("authorization") ?? "";
    expect(authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=id\/\d{8}\/auto\/s3\/aws4_request,/,
    );
    expect(await Deno.readTextFile(join(to, BERKELEY_MONO))).toBe("wOF2 font");
  });

  it("fails the build when the bucket says no", async () => {
    using _fetch = stub(
      globalThis,
      "fetch",
      () =>
        Promise.resolve(
          new Response("<Error/>", { status: 403, statusText: "Forbidden" }),
        ),
    );
    await expect(downloadFonts(config, [BERKELEY_MONO], to)).rejects.toThrow(
      "403",
    );
  });

  it("fails the build when the file is not a font", async () => {
    using _fetch = stub(
      globalThis,
      "fetch",
      () => Promise.resolve(new Response("<html>")),
    );
    await expect(downloadFonts(config, [BERKELEY_MONO], to)).rejects.toThrow(
      "not a WOFF2",
    );
  });
});
