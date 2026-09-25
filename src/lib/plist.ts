/**
 * Apple XML property list serialisation and parsing.
 */

import { parseXml, type XmlElement, XmlParseError } from "./xml.ts";

export type PlistValue =
  | string
  | number
  | boolean
  | Date
  | Uint8Array
  | PlistValue[]
  | PlistDict;

export interface PlistDict {
  [key: string]: PlistValue;
}

const PROLOG = '<?xml version="1.0" encoding="UTF-8"?>\n' +
  '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" ' +
  '"http://www.apple.com/DTDs/PropertyList-1.0.dtd">\n' +
  '<plist version="1.0">\n';

const EPILOG = "</plist>\n";

/**
 * Characters XML 1.0 cannot carry at all, not even as a reference: C0 controls
 * other than tab, LF and CR, U+FFFE and U+FFFF, and (under the `u` flag, which
 * matches a surrogate only when unpaired) lone surrogates.
 */
const NON_XML_CHARS =
  // deno-lint-ignore no-control-regex
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\uFFFE\uFFFF\uD800-\uDFFF]/gu;

/**
 * Escapes text for use in element content. Characters XML cannot represent are
 * dropped, since a document containing them is rejected outright by plutil
 * and by the device.
 */
function escapeText(value: string): string {
  return value
    .replace(NON_XML_CHARS, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

function toBase64(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary);
}

function fromBase64(value: string): Uint8Array {
  const binary = atob(value.replace(/\s+/g, ""));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

/** ISO 8601 with second precision, which is the form Apple emits. */
function toPlistDate(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

function serialize(value: PlistValue, depth: number, out: string[]): void {
  const pad = "\t".repeat(depth);

  if (typeof value === "string") {
    out.push(`${pad}<string>${escapeText(value)}</string>`);
    return;
  }

  if (typeof value === "boolean") {
    out.push(`${pad}${value ? "<true/>" : "<false/>"}`);
    return;
  }

  if (typeof value === "number") {
    const tag = Number.isInteger(value) ? "integer" : "real";
    out.push(`${pad}<${tag}>${value}</${tag}>`);
    return;
  }

  if (value instanceof Date) {
    out.push(`${pad}<date>${toPlistDate(value)}</date>`);
    return;
  }

  if (value instanceof Uint8Array) {
    out.push(`${pad}<data>${toBase64(value)}</data>`);
    return;
  }

  if (Array.isArray(value)) {
    if (value.length === 0) {
      out.push(`${pad}<array/>`);
      return;
    }
    out.push(`${pad}<array>`);
    for (const item of value) {
      serialize(item, depth + 1, out);
    }
    out.push(`${pad}</array>`);
    return;
  }

  const keys = Object.keys(value);
  if (keys.length === 0) {
    out.push(`${pad}<dict/>`);
    return;
  }
  out.push(`${pad}<dict>`);
  for (const key of keys) {
    const child = value[key];
    if (child === undefined) {
      continue;
    }
    out.push(`${pad}\t<key>${escapeText(key)}</key>`);
    serialize(child, depth + 1, out);
  }
  out.push(`${pad}</dict>`);
}

export function buildPlist(value: PlistValue): string {
  const out: string[] = [];
  serialize(value, 0, out);
  return PROLOG + out.join("\n") + "\n" + EPILOG;
}

export class PlistParseError extends Error {
  constructor(message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "PlistParseError";
  }
}

function parseElement(element: XmlElement): PlistValue {
  const text = element.text;

  switch (element.name) {
    case "string":
      return text;
    case "true":
      return true;
    case "false":
      return false;
    case "integer":
      return Number.parseInt(text.trim(), 10);
    case "real":
      return Number.parseFloat(text.trim());
    case "date":
      return new Date(text.trim());
    case "data":
      return fromBase64(text);
    case "array":
      return element.children.map(parseElement);
    case "dict": {
      const dict: PlistDict = {};
      const children = element.children;
      for (let i = 0; i < children.length; i += 2) {
        const keyNode = children[i];
        const valueNode = children[i + 1];
        if (keyNode === undefined || keyNode.name !== "key") {
          throw new PlistParseError(
            `Expected <key> at position ${i} inside <dict>, found <${
              keyNode?.name ?? "nothing"
            }>`,
          );
        }
        if (valueNode === undefined) {
          throw new PlistParseError(`<key>${keyNode.text}</key> has no value`);
        }
        dict[keyNode.text] = parseElement(valueNode);
      }
      return dict;
    }
    default:
      throw new PlistParseError(`Unsupported plist element <${element.name}>`);
  }
}

/** Parses an Apple XML property list. Needs no DOM. */
export function parsePlist(xml: string): PlistValue {
  let root: XmlElement;
  try {
    root = parseXml(xml);
  } catch (error) {
    if (error instanceof XmlParseError) {
      throw new PlistParseError(error.message, { cause: error });
    }
    throw error;
  }

  if (root.name !== "plist") {
    throw new PlistParseError(
      `Expected a <plist> root element, found <${root.name}>`,
    );
  }

  const first = root.children[0];
  if (first === undefined) {
    throw new PlistParseError("<plist> element is empty");
  }

  return parseElement(first);
}

/* -------------------------------------------------------------- narrowing --- */

export function isPlistDict(value: PlistValue | undefined): value is PlistDict {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date) &&
    !(value instanceof Uint8Array)
  );
}

export function asDict(value: PlistValue | undefined): PlistDict | undefined {
  return isPlistDict(value) ? value : undefined;
}

export function asArray(
  value: PlistValue | undefined,
): PlistValue[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

export function asString(value: PlistValue | undefined): string | undefined {
  return typeof value === "string" ? value : undefined;
}

export function asStringArray(
  value: PlistValue | undefined,
): string[] | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  return value.filter((item): item is string => typeof item === "string");
}
