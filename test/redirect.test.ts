import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { SITE_URL } from "../pages/pages.ts";
import { redirect } from "../scripts/redirect.ts";

const OLD = "https://apple.mobileconfig.deno.net";

describe("the Deno Deploy redirect", () => {
  for (const method of ["GET", "HEAD"]) {
    it(`sends ${method} to the same path and query on the site`, () => {
      for (
        const [path, target] of [
          ["/", SITE_URL],
          ["/finalize.html", `${SITE_URL}finalize.html`],
          [
            "/finalize.html?check=live",
            `${SITE_URL}finalize.html?check=live`,
          ],
          [
            "/profiles/quad9.mobileconfig",
            `${SITE_URL}profiles/quad9.mobileconfig`,
          ],
        ]
      ) {
        const answer = redirect(new Request(`${OLD}${path}`, { method }));
        expect({
          path,
          status: answer.status,
          to: answer.headers.get("Location"),
        })
          .toEqual({ path, status: 301, to: target });
      }
    });
  }

  it("never leaves the site, whatever the path looks like", () => {
    for (
      const path of [
        "//evil.example/x",
        "/%2F%2Fevil.example",
        "/@evil.example",
      ]
    ) {
      const to = redirect(new Request(`${OLD}${path}`)).headers.get(
        "Location",
      )!;
      expect({ path, host: new URL(to).host })
        .toEqual({ path, host: new URL(SITE_URL).host });
    }
  });

  it("is what Deno Deploy runs, with nothing to build", () => {
    const config = JSON.parse(
      Deno.readTextFileSync(new URL("../deno.json", import.meta.url)),
    );
    expect(config.deploy).toEqual({
      runtime: { type: "dynamic", entrypoint: "scripts/redirect.ts" },
    });
  });
});
