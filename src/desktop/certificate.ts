/**
 * Just enough X.509 reading to find a certificate's Subject Key Identifier,
 * which is how `security cms -Z` picks a signing identity.
 */

interface Tlv {
  readonly tag: number;
  /** Offset of the first content byte. */
  readonly start: number;
  /** Offset just past the last content byte. */
  readonly end: number;
}

/** OID 2.5.29.14, subjectKeyIdentifier, as encoded content bytes. */
const SUBJECT_KEY_IDENTIFIER = [0x55, 0x1d, 0x0e];

const SEQUENCE = 0x30;
const OCTET_STRING = 0x04;
const OBJECT_IDENTIFIER = 0x06;
/** `[3] EXPLICIT`, the tag wrapping `extensions` in a TBSCertificate. */
const EXTENSIONS = 0xa3;

function readTlv(bytes: Uint8Array, offset: number): Tlv {
  const tag = bytes[offset];
  const first = bytes[offset + 1];
  if (tag === undefined || first === undefined) {
    throw new RangeError("Truncated DER");
  }

  let length = first;
  let start = offset + 2;
  if (first >= 0x80) {
    const count = first & 0x7f;
    // Indefinite (0) and absurd lengths never occur in a DER certificate.
    if (count === 0 || count > 4) throw new RangeError("Unsupported length");
    length = 0;
    for (let i = 0; i < count; i++) {
      const byte = bytes[start + i];
      if (byte === undefined) throw new RangeError("Truncated DER");
      length = length * 256 + byte;
    }
    start += count;
  }

  const end = start + length;
  if (end > bytes.length) throw new RangeError("Truncated DER");
  return { tag, start, end };
}

function children(bytes: Uint8Array, parent: Tlv): Tlv[] {
  const found: Tlv[] = [];
  for (let offset = parent.start; offset < parent.end;) {
    const child = readTlv(bytes, offset);
    found.push(child);
    offset = child.end;
  }
  return found;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0"))
    .join("").toUpperCase();
}

function sameBytes(bytes: Uint8Array, tlv: Tlv, expected: number[]): boolean {
  return tlv.end - tlv.start === expected.length &&
    expected.every((byte, i) => bytes[tlv.start + i] === byte);
}

/**
 * The Subject Key Identifier of a DER certificate as uppercase hex, or
 * undefined when it has none or cannot be read.
 */
export function subjectKeyId(der: Uint8Array): string | undefined {
  try {
    const certificate = readTlv(der, 0);
    const [tbs] = children(der, certificate);
    if (certificate.tag !== SEQUENCE || tbs?.tag !== SEQUENCE) return undefined;

    const wrapper = children(der, tbs).find((tlv) => tlv.tag === EXTENSIONS);
    const [extensions] = wrapper === undefined ? [] : children(der, wrapper);
    if (extensions?.tag !== SEQUENCE) return undefined;

    for (const extension of children(der, extensions)) {
      const parts = children(der, extension);
      const [oid] = parts;
      const value = parts.at(-1);
      if (
        oid?.tag !== OBJECT_IDENTIFIER || value?.tag !== OCTET_STRING ||
        !sameBytes(der, oid, SUBJECT_KEY_IDENTIFIER)
      ) {
        continue;
      }
      // The extension value is itself a DER OCTET STRING holding the key id.
      const keyId = readTlv(der, value.start);
      if (keyId.tag !== OCTET_STRING || keyId.end !== value.end) {
        return undefined;
      }
      return hex(der.subarray(keyId.start, keyId.end));
    }
    return undefined;
  } catch {
    return undefined;
  }
}

/** Decodes one PEM `CERTIFICATE` block to DER. */
export function pemToDer(pem: string): Uint8Array {
  const body = pem
    .replace(/-----(BEGIN|END) CERTIFICATE-----/g, "")
    .replace(/\s+/g, "");
  return Uint8Array.from(atob(body), (char) => char.charCodeAt(0));
}
