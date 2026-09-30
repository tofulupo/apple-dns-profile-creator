//! Just enough X.509 reading to find a certificate's Subject Key Identifier,
//! which is how `security cms -Z` picks a signing identity.

use base64::Engine as _;
use base64::engine::general_purpose::STANDARD;

/// OID 2.5.29.14, subjectKeyIdentifier, as encoded content bytes.
const SUBJECT_KEY_IDENTIFIER: &[u8] = &[0x55, 0x1d, 0x0e];

const SEQUENCE: u8 = 0x30;
const OCTET_STRING: u8 = 0x04;
const OBJECT_IDENTIFIER: u8 = 0x06;
/// `[3] EXPLICIT`, the tag wrapping `extensions` in a TBSCertificate.
const EXTENSIONS: u8 = 0xa3;

#[derive(Debug, Clone, Copy)]
struct Tlv {
    tag: u8,
    /// Offset of the first content byte.
    start: usize,
    /// Offset just past the last content byte.
    end: usize,
}

impl Tlv {
    fn content(self, der: &[u8]) -> &[u8] {
        &der[self.start..self.end]
    }
}

/// The element at `offset`, which must end by `limit`.
fn read_tlv(der: &[u8], offset: usize, limit: usize) -> Option<Tlv> {
    let tag = *der.get(offset)?;
    let first = *der.get(offset + 1)?;
    let mut start = offset + 2;
    let length = if first < 0x80 {
        usize::from(first)
    } else {
        let count = usize::from(first & 0x7f);
        // Indefinite (0) and absurd lengths never occur in a DER certificate.
        if count == 0 || count > 4 {
            return None;
        }
        let bytes = der.get(start..start + count)?;
        start += count;
        bytes
            .iter()
            .fold(0, |length, &byte| (length << 8) | usize::from(byte))
    };
    let end = start.checked_add(length)?;
    (end <= limit.min(der.len())).then_some(Tlv { tag, start, end })
}

fn children(der: &[u8], parent: Tlv) -> Option<Vec<Tlv>> {
    let mut found = Vec::new();
    let mut offset = parent.start;
    while offset < parent.end {
        let child = read_tlv(der, offset, parent.end)?;
        found.push(child);
        offset = child.end;
    }
    Some(found)
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02X}")).collect()
}

/// The Subject Key Identifier of a DER certificate as uppercase hex, or None
/// when it has none or cannot be read.
pub fn subject_key_id(der: &[u8]) -> Option<String> {
    let certificate = read_tlv(der, 0, der.len())?;
    let tbs = *children(der, certificate)?.first()?;
    if certificate.tag != SEQUENCE || tbs.tag != SEQUENCE {
        return None;
    }

    let wrapper = children(der, tbs)?
        .into_iter()
        .find(|tlv| tlv.tag == EXTENSIONS)?;
    let extensions = *children(der, wrapper)?.first()?;
    if extensions.tag != SEQUENCE {
        return None;
    }

    for extension in children(der, extensions)? {
        let parts = children(der, extension)?;
        let (Some(oid), Some(value)) = (parts.first(), parts.last()) else {
            continue;
        };
        if oid.tag != OBJECT_IDENTIFIER
            || value.tag != OCTET_STRING
            || oid.content(der) != SUBJECT_KEY_IDENTIFIER
        {
            continue;
        }
        // The extension value is itself a DER OCTET STRING holding the key id.
        let key_id = read_tlv(der, value.start, value.end)?;
        if key_id.tag != OCTET_STRING || key_id.end != value.end {
            return None;
        }
        return Some(hex(key_id.content(der)));
    }
    None
}

/// Decodes one PEM `CERTIFICATE` block to DER, or None if it is not base64.
pub fn pem_to_der(pem: &str) -> Option<Vec<u8>> {
    let body: String = pem
        .replace("-----BEGIN CERTIFICATE-----", "")
        .replace("-----END CERTIFICATE-----", "")
        .chars()
        .filter(|c| !c.is_whitespace())
        .collect();
    STANDARD.decode(body).ok()
}

/// Throwaway self-signed certificates for tests. Generated once with openssl;
/// the private keys were discarded, so these can sign nothing.
#[cfg(test)]
pub mod fixtures {
    pub struct Certificate {
        pub sha1: &'static str,
        pub subject_key_id: Option<&'static str>,
        pub pem: &'static str,
    }

    /// CN "DNS Test With SKI", critical Code Signing EKU.
    pub const WITH_SKI: Certificate = Certificate {
        sha1: "521DE52A9299A20983B50C899FBD043C843CD46E",
        subject_key_id: Some("FF587220711AD856672BC5BE621946481D52D34C"),
        pem: "-----BEGIN CERTIFICATE-----
MIIBhDCCASqgAwIBAgIUbdbDxMGQzhZyP4LGyEaV9LGc4rgwCgYIKoZIzj0EAwIw
HDEaMBgGA1UEAwwRRE5TIFRlc3QgV2l0aCBTS0kwHhcNMjYwOTI2MDYzODMwWhcN
MzYwOTIzMDYzODMwWjAcMRowGAYDVQQDDBFETlMgVGVzdCBXaXRoIFNLSTBZMBMG
ByqGSM49AgEGCCqGSM49AwEHA0IABDjx+bHih6n+/sQ6X5rLmwA2+VGcpTlghKZ5
oLxEnK5MIBToKcb5/QNCzjj+GaSCLLggHgiP4jp2GYT6u6pcrHijSjBIMB0GA1Ud
DgQWBBT/WHIgcRrYVmcrxb5iGUZIHVLTTDAPBgNVHRMBAf8EBTADAQH/MBYGA1Ud
JQEB/wQMMAoGCCsGAQUFBwMDMAoGCCqGSM49BAMCA0gAMEUCIQCzUHj39YFAbdmA
W9nOkUCvE1JQuWXOjsLoNimG1jJa9wIgAtxT1xZmvoQljbxyxNIxC0J0rBDabF0r
rF6ZKBnAfj0=
-----END CERTIFICATE-----",
    };

    /// CN "DNS Test No SKI", no Subject Key Identifier extension.
    pub const WITHOUT_SKI: Certificate = Certificate {
        sha1: "F2AE54BEA0E67175D5443D384345FA402F09479B",
        subject_key_id: None,
        pem: "-----BEGIN CERTIFICATE-----
MIIBRzCB76ADAgECAhQSWhbiveABDxR99wvDn/+I4x6ytDAKBggqhkjOPQQDAjAa
MRgwFgYDVQQDDA9ETlMgVGVzdCBObyBTS0kwHhcNMjYwOTI2MDYzODMwWhcNMzYw
OTIzMDYzODMwWjAaMRgwFgYDVQQDDA9ETlMgVGVzdCBObyBTS0kwWTATBgcqhkjO
PQIBBggqhkjOPQMBBwNCAARQW92wjpNES8vvIcFiKPnjdGifsrUDsSbFzj2GYCWb
IHiPgIKjNpeUWjZ50Sk4dgCJ0rGKapbe3oHAfi3+i3syoxMwETAPBgNVHRMBAf8E
BTADAQH/MAoGCCqGSM49BAMCA0cAMEQCID5a3WQSBEff+R2EK6ta/6vggdyVL+nU
JgSm8gqEJ1s8AiA/CX6VqYB25Q99F7AOtNCEZj1Xbv3dbNAcPYTo1WvS4w==
-----END CERTIFICATE-----",
    };
}

#[cfg(test)]
mod tests {
    use super::fixtures::{WITH_SKI, WITHOUT_SKI};
    use super::*;

    #[test]
    fn reads_the_identifier_openssl_reports() {
        let der = pem_to_der(WITH_SKI.pem).unwrap();
        assert_eq!(subject_key_id(&der).as_deref(), WITH_SKI.subject_key_id);
    }

    #[test]
    fn is_none_for_a_certificate_without_the_extension() {
        let der = pem_to_der(WITHOUT_SKI.pem).unwrap();
        assert_eq!(subject_key_id(&der), None);
    }

    #[test]
    fn is_none_for_truncated_or_unrelated_data_instead_of_panicking() {
        let der = pem_to_der(WITH_SKI.pem).unwrap();
        for bytes in [
            &[][..],
            &der[..40],
            &der[..der.len() - 1],
            b"not a certificate",
            &[0x30, 0x80, 0x00, 0x00],
            &[0x30, 0x84, 0xff, 0xff, 0xff, 0xff],
        ] {
            assert_eq!(subject_key_id(bytes), None, "{bytes:02X?}");
        }
    }

    #[test]
    fn rejects_pem_that_is_not_base64() {
        assert_eq!(pem_to_der("-----BEGIN CERTIFICATE-----\n@@@\n"), None);
    }
}
