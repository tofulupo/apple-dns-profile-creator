use plist::{Dictionary, Value};

use crate::opened::MAX_PROFILE_BYTES;

/// The payload and declaration types src/lib/profile.ts writes.
const DNS_PAYLOAD_TYPE: &str = "com.apple.dnsSettings.managed";
const DECLARATIONS_PAYLOAD_TYPE: &str = "com.apple.declarations";
const DECLARATION_TYPES: [&str; 2] = [
    "com.apple.activation.simple",
    "com.apple.configuration.network.dns-settings",
];

const FONT_PAYLOAD_TYPE: &str = "com.apple.font";

const REFUSED: &str = "The profile holds more than DNS settings, so it was not saved.";
const NOT_A_FONT: &str =
    "A font in the profile is not a TrueType or OpenType font, so it was not saved.";
const COLLECTION: &str =
    "A font in the profile is a collection (.ttc or .otc), which Apple devices don't install.";
const WEB_FONT: &str =
    "A font in the profile is a web font (WOFF), which Apple devices don't install.";

#[derive(Debug, PartialEq, Eq)]
pub enum Kind {
    Dns,
    Fonts,
}

fn payload_type(dict: &Dictionary) -> Option<&str> {
    dict.get("PayloadType")?.as_string()
}

fn declaration_type(data: &Value) -> Option<String> {
    let json: serde_json::Value = serde_json::from_slice(data.as_data()?).ok()?;
    Some(json.get("Type")?.as_str()?.to_owned())
}

fn holds_only_dns_settings(payload: &Value) -> bool {
    let Some(payload) = payload.as_dictionary() else {
        return false;
    };
    match payload_type(payload) {
        Some(DNS_PAYLOAD_TYPE) => true,
        Some(DECLARATIONS_PAYLOAD_TYPE) => payload
            .get("Declarations")
            .and_then(Value::as_array)
            .is_some_and(|declarations| {
                declarations.iter().all(|declaration| {
                    declaration_type(declaration)
                        .is_some_and(|kind| DECLARATION_TYPES.contains(&kind.as_str()))
                })
            }),
        _ => false,
    }
}

fn is_font_payload(payload: &Value) -> bool {
    payload
        .as_dictionary()
        .is_some_and(|payload| payload_type(payload) == Some(FONT_PAYLOAD_TYPE))
}

fn identified(dict: &Dictionary) -> bool {
    dict.get("PayloadIdentifier")
        .and_then(Value::as_string)
        .is_some_and(|id| !id.is_empty())
        && dict
            .get("PayloadUUID")
            .and_then(Value::as_string)
            .is_some_and(|uuid| !uuid.is_empty())
        && dict
            .get("PayloadVersion")
            .and_then(Value::as_signed_integer)
            .is_some()
}

/// Apple installs one TrueType or OpenType font per payload, told apart by
/// the first four bytes of the font file.
fn check_font(payload: &Value) -> Result<(), String> {
    let Some(payload) = payload
        .as_dictionary()
        .filter(|payload| identified(payload))
    else {
        return Err(REFUSED.into());
    };
    let font = payload
        .get("Font")
        .and_then(Value::as_data)
        .ok_or(NOT_A_FONT)?;
    match font.get(..4) {
        Some([0, 1, 0, 0] | b"true" | b"OTTO") => Ok(()),
        Some(b"ttcf") => Err(COLLECTION.into()),
        Some(b"wOFF" | b"wOF2") => Err(WEB_FONT.into()),
        _ => Err(NOT_A_FONT.into()),
    }
}

/// Which kind of profile `xml` is: DNS settings as the pages build them, or
/// fonts by Apple's rules. The app saves, shares and signs nothing else.
pub fn check(xml: &str) -> Result<Kind, String> {
    if xml.len() as u64 > MAX_PROFILE_BYTES {
        return Err(REFUSED.into());
    }
    let profile = Value::from_reader_xml(xml.as_bytes()).map_err(|_| REFUSED.to_owned())?;
    let Some(profile) = profile.as_dictionary() else {
        return Err(REFUSED.into());
    };
    let Some(payloads) = profile
        .get("PayloadContent")
        .and_then(Value::as_array)
        .filter(|payloads| !payloads.is_empty())
    else {
        return Err(REFUSED.into());
    };
    if payload_type(profile) != Some("Configuration") {
        return Err(REFUSED.into());
    }
    if payloads.iter().all(holds_only_dns_settings) {
        return Ok(Kind::Dns);
    }
    if identified(profile) && payloads.iter().all(is_font_payload) {
        for payload in payloads {
            check_font(payload)?;
        }
        return Ok(Kind::Fonts);
    }
    Err(REFUSED.into())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn accepts_what_the_pages_build_in_either_format() {
        let golden = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("../test/golden");
        let mut paths: Vec<_> = std::fs::read_dir(golden)
            .unwrap()
            .map(|entry| entry.unwrap().path())
            .collect();
        assert!(paths.len() > 1);
        paths.push("tests/fixtures/declarations.mobileconfig".into());
        for path in paths {
            let xml = std::fs::read_to_string(&path).unwrap();
            assert_eq!(check(&xml), Ok(Kind::Dns), "{}", path.display());
        }
    }

    #[test]
    fn refuses_other_payloads_and_declarations() {
        let dns = include_str!("../../test/golden/full-surface.mobileconfig");
        let declarations = include_str!("../tests/fixtures/declarations.mobileconfig");
        // base64 of {"Type":"com.apple.configuration.passcode.settings"}
        let passcode = "eyJUeXBlIjoiY29tLmFwcGxlLmNvbmZpZ3VyYXRpb24ucGFzc2NvZGUuc2V0dGluZ3MifQ==";
        for xml in [
            dns.replacen(
                "<string>com.apple.dnsSettings.managed</string>",
                "<string>com.apple.security.root</string>",
                1,
            ),
            dns.replace("<string>Configuration</string>", "<string>Other</string>"),
            declarations.replacen("<data>", &format!("<data>{passcode}</data><data>"), 1),
        ] {
            assert_eq!(check(&xml), Err(REFUSED.into()));
        }
    }

    const FONTS: &str = include_str!("../tests/fixtures/fonts.mobileconfig");
    /// The OpenType font's data in FONTS.
    const OTF: &str = "<data>T1RUTwAAAAA=</data>";

    #[test]
    fn accepts_truetype_and_opentype_fonts() {
        assert_eq!(check(FONTS), Ok(Kind::Fonts));
        // "true", the old Apple TrueType tag
        let apple = FONTS.replace(OTF, "<data>dHJ1ZQAAAAA=</data>");
        assert_eq!(check(&apple), Ok(Kind::Fonts));
    }

    #[test]
    fn refuses_collections_and_web_fonts() {
        for (data, error) in [
            ("dHRjZgAAAAA=", COLLECTION),
            ("d09GRgAAAAA=", WEB_FONT),
            ("d09GMgAAAAA=", WEB_FONT),
        ] {
            let xml = FONTS.replace(OTF, &format!("<data>{data}</data>"));
            assert_eq!(check(&xml), Err(error.into()), "{data}");
        }
    }

    #[test]
    fn refuses_a_font_payload_with_a_missing_or_empty_font() {
        let empty = FONTS.replace(OTF, "<data></data>");
        let missing = FONTS.replace(&format!("<key>Font</key>\n\t\t\t{OTF}"), "");
        assert_ne!(missing, FONTS);
        for xml in [empty, missing] {
            assert_eq!(check(&xml), Err(NOT_A_FONT.into()));
        }
    }

    #[test]
    fn refuses_fonts_mixed_with_dns_settings() {
        let mixed = FONTS.replacen(
            "<string>com.apple.font</string>",
            "<string>com.apple.dnsSettings.managed</string>",
            1,
        );
        assert_eq!(check(&mixed), Err(REFUSED.into()));
    }

    #[test]
    fn refuses_fonts_without_identifier_uuid_or_version() {
        for key in ["PayloadIdentifier", "PayloadUUID", "PayloadVersion"] {
            let renamed = FONTS.replacen(&format!("<key>{key}</key>"), "<key>Unknown</key>", 1);
            assert_eq!(check(&renamed), Err(REFUSED.into()), "{key} in a payload");
            let at = FONTS.rfind(&format!("<key>{key}</key>")).unwrap();
            let mut top = FONTS.to_owned();
            top.replace_range(at..at + key.len() + 11, "<key>Unknown</key>");
            assert_eq!(check(&top), Err(REFUSED.into()), "{key} on the profile");
        }
    }

    #[test]
    fn refuses_anything_that_is_not_a_profile() {
        let empty = r#"<plist version="1.0"><dict><key>PayloadType</key><string>Configuration</string><key>PayloadContent</key><array/></dict></plist>"#;
        let huge = format!("<plist>{}</plist>", " ".repeat(MAX_PROFILE_BYTES as usize));
        for xml in ["", "not xml", "<plist><array/></plist>", empty, &huge] {
            assert_eq!(check(xml), Err(REFUSED.into()), "{:.40}", xml);
        }
    }
}
