/**
 * Tests for the minimal XML reader.
 */
import { describe, it } from "@std/testing/bdd";
import { expect } from "@std/expect";

import { parseXml, XmlParseError } from "../../src/lib/xml.ts";

describe("parseXml", () => {
  it("reads the root element and its attributes", () => {
    const root = parseXml('<plist version="1.0"><dict/></plist>');
    expect(root.name).toBe("plist");
    expect(root.attributes).toEqual({ version: "1.0" });
    expect(root.children).toHaveLength(1);
  });

  it("skips the declaration, doctype and comments", () => {
    const root = parseXml(`<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<!-- a comment -->
<plist version="1.0"><string>x</string></plist>`);
    expect(root.name).toBe("plist");
    expect(root.children[0]?.name).toBe("string");
  });

  it("handles self-closing elements", () => {
    const root = parseXml("<dict><true/><false/></dict>");
    expect(root.children.map((c) => c.name)).toEqual(["true", "false"]);
    expect(root.children[0]?.text).toBe("");
  });

  it("collects only direct text, unlike DOM textContent", () => {
    const root = parseXml("<dict><key>a</key><string>b</string></dict>");
    expect(root.text.trim()).toBe("");
    expect(root.children[0]?.text).toBe("a");
    expect(root.children[1]?.text).toBe("b");
  });

  it("preserves an empty string element", () => {
    const root = parseXml("<array><string></string></array>");
    expect(root.children[0]?.text).toBe("");
  });

  it("decodes named entities", () => {
    const root = parseXml(
      "<string>&lt;tag&gt; &amp; &quot;quoted&quot; &apos;q&apos;</string>",
    );
    expect(root.text).toBe(`<tag> & "quoted" 'q'`);
  });

  it("decodes numeric and hex character references", () => {
    expect(parseXml("<string>&#65;&#x42;&#x1F600;</string>").text).toBe("AB😀");
  });

  it("leaves unknown entities alone rather than guessing", () => {
    expect(parseXml("<string>&nbsp;</string>").text).toBe("&nbsp;");
  });

  it("reads CDATA as text", () => {
    expect(parseXml("<string><![CDATA[a <b> & c]]></string>").text).toBe(
      "a <b> & c",
    );
  });

  it("handles multi-byte content", () => {
    expect(parseXml("<string>Server location: 🇺🇸.</string>").text).toBe(
      "Server location: 🇺🇸.",
    );
  });

  it("accepts single-quoted attribute values", () => {
    expect(parseXml("<plist version='1.0'/>").attributes).toEqual({
      version: "1.0",
    });
  });
});

describe("parseXml rejects malformed input", () => {
  const cases: ReadonlyArray<readonly [string, string]> = [
    ["an unclosed element", "<plist><dict>"],
    ["a mismatched closing tag", "<plist><dict></array></plist>"],
    ["a truncated closing tag", "<plist><dict/></plist"],
    ["no root element", '<?xml version="1.0"?>'],
    ["an empty document", ""],
    ["an unterminated comment", "<plist><!-- oops </plist>"],
    ["an unquoted attribute value", "<plist version=1.0></plist>"],
    ["content after the root element", "<plist/><extra/>"],
    ["an unterminated CDATA section", "<string><![CDATA[oops</string>"],
    ["a code point beyond Unicode", "<string>&#99999999;</string>"],
    ["a hex code point beyond Unicode", "<string>&#x110000;</string>"],
    ["a character XML forbids", "<string>&#0;</string>"],
    ["a lone surrogate", "<string>&#xD800;</string>"],
    ["a decimal reference with hex digits", "<string>&#12ab;</string>"],
    ["an empty character reference", "<string>&#;</string>"],
    ["a bad reference in an attribute", '<plist version="&#99999999;"/>'],
  ];

  for (const [label, source] of cases) {
    it(`throws on ${label}`, () => {
      expect(() => parseXml(source)).toThrow(XmlParseError);
    });
  }

  it("reports the line number", () => {
    try {
      parseXml("<plist>\n  <dict>\n    <key>a</key>\n");
      throw new Error("expected a throw");
    } catch (error) {
      expect(error).toBeInstanceOf(XmlParseError);
      expect((error as XmlParseError).message).toMatch(/line \d+/);
    }
  });
});
