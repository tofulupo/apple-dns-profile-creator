import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { buildProfileXml } from "../../src/lib/profile.ts";
import { readProfileFile } from "../../src/ui/dropzone.ts";
import { config } from "../helpers/configs.ts";
import { stubUuid } from "../helpers/uuid.ts";

function profileFile(name: string, systemScope = true): File {
  const xml = buildProfileXml(
    [config(), config({ name: "Two" })],
    { systemScope, identifierPrefix: "com.example." },
    stubUuid(),
  );
  return new File([xml], name);
}

describe("readProfileFile", () => {
  it("marks each configuration with the file it came from", async () => {
    const { configs } = await readProfileFile(
      profileFile("encrypted-dns 3.mobileconfig"),
    );
    const [first, second] = configs.map((c) => c.source);
    expect(first?.file).toBe("encrypted-dns 3.mobileconfig");
    expect(first?.profileId).toMatch(/^com\.example\./);
    expect(first?.systemScope).toBe(true);
    expect(first?.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(second).toEqual(first);
  });

  it("hashes the content, not the name", async () => {
    const a = await readProfileFile(profileFile("a.mobileconfig"));
    const b = await readProfileFile(profileFile("b.mobileconfig"));
    const user = await readProfileFile(profileFile("c.mobileconfig", false));
    expect(a.configs[0]?.source?.sha256).toBe(b.configs[0]?.source?.sha256);
    expect(a.configs[0]?.source?.sha256).not.toBe(
      user.configs[0]?.source?.sha256,
    );
  });
});
