use plist::{Dictionary, Value};

use crate::opened::MAX_PROFILE_BYTES;

/// The payload and declaration types src/lib/profile.ts writes.
const DNS_PAYLOAD_TYPE: &str = "com.apple.dnsSettings.managed";
const DECLARATIONS_PAYLOAD_TYPE: &str = "com.apple.declarations";
const DECLARATION_TYPES: [&str; 2] = [
    "com.apple.activation.simple",
    "com.apple.configuration.network.dns-settings",
];

const REFUSED: &str = "The profile holds more than DNS settings, so it was not saved.";

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

/// Whether `xml` is a profile of DNS settings, as the pages build them, so
/// the app saves, shares and signs nothing else.
pub fn check(xml: &str) -> Result<(), String> {
    if xml.len() as u64 > MAX_PROFILE_BYTES {
        return Err(REFUSED.into());
    }
    let profile = Value::from_reader_xml(xml.as_bytes()).map_err(|_| REFUSED.to_owned())?;
    let Some(profile) = profile.as_dictionary() else {
        return Err(REFUSED.into());
    };
    let payloads = profile.get("PayloadContent").and_then(Value::as_array);
    if payload_type(profile) == Some("Configuration")
        && payloads.is_some_and(|payloads| {
            !payloads.is_empty() && payloads.iter().all(holds_only_dns_settings)
        })
    {
        Ok(())
    } else {
        Err(REFUSED.into())
    }
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
            assert_eq!(check(&xml), Ok(()), "{}", path.display());
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

    #[test]
    fn refuses_anything_that_is_not_a_profile() {
        let empty = r#"<plist version="1.0"><dict><key>PayloadType</key><string>Configuration</string><key>PayloadContent</key><array/></dict></plist>"#;
        let huge = format!("<plist>{}</plist>", " ".repeat(MAX_PROFILE_BYTES as usize));
        for xml in ["", "not xml", "<plist><array/></plist>", empty, &huge] {
            assert_eq!(check(xml), Err(REFUSED.into()), "{:.40}", xml);
        }
    }
}
