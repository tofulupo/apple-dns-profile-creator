use plist::{Dictionary, Value};
use serde_json::Value as Json;

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

fn is_dns_payload(payload: &Value) -> bool {
    payload.as_dictionary().is_some_and(|payload| {
        matches!(
            payload_type(payload),
            Some(DNS_PAYLOAD_TYPE | DECLARATIONS_PAYLOAD_TYPE)
        )
    })
}

/// The path of the first key or value src/lib/profile.ts doesn't write.
type Checked = Result<(), String>;
type Rule = (&'static str, fn(&Json) -> bool);

fn any(_: &Json) -> bool {
    true
}

fn string(value: &Json) -> bool {
    value.is_string()
}

fn strings(value: &Json) -> bool {
    value
        .as_array()
        .is_some_and(|items| items.iter().all(Json::is_string))
}

fn boolean(value: &Json) -> bool {
    value.is_boolean()
}

fn version_one(value: &Json) -> bool {
    value.as_i64() == Some(1)
}

/// Only the keys in `required` and `optional`, each passing its rule.
fn dict<'a>(
    value: &'a Json,
    at: &str,
    required: &[Rule],
    optional: &[Rule],
) -> Result<&'a serde_json::Map<String, Json>, String> {
    let dict = value.as_object().ok_or_else(|| at.to_owned())?;
    if let Some((key, _)) = required.iter().find(|(key, _)| !dict.contains_key(*key)) {
        return Err(format!("{at}.{key} (missing)"));
    }
    for (key, item) in dict {
        match required
            .iter()
            .chain(optional)
            .find(|(name, _)| name == key)
        {
            Some((_, ok)) if ok(item) => {}
            _ => return Err(format!("{at}.{key}")),
        }
    }
    Ok(dict)
}

fn dns_settings(value: &Json, at: &str) -> Checked {
    let settings = dict(
        value,
        at,
        &[
            ("DNSProtocol", |v| v == "HTTPS" || v == "TLS"),
            ("ServerAddresses", strings),
        ],
        &[
            ("ServerURL", string),
            ("ServerName", string),
            ("AllowFailover", |v| v == true),
            ("SupplementalMatchDomains", strings),
        ],
    )?;
    let server = if settings["DNSProtocol"] == "HTTPS" {
        "ServerURL"
    } else {
        "ServerName"
    };
    let other = if server == "ServerURL" {
        "ServerName"
    } else {
        "ServerURL"
    };
    if !settings.contains_key(server) {
        return Err(format!("{at}.{server} (missing)"));
    }
    if settings.contains_key(other) {
        return Err(format!("{at}.{other}"));
    }
    Ok(())
}

fn never_connect(value: &Json) -> bool {
    value.as_array().is_some_and(|parameters| {
        parameters.iter().all(|parameter| {
            dict(
                parameter,
                "",
                &[
                    ("DomainAction", |v| v == "NeverConnect"),
                    ("Domains", strings),
                ],
                &[],
            )
            .is_ok()
        })
    })
}

fn on_demand_rules(value: &Json, at: &str) -> Checked {
    let rules = value.as_array().ok_or_else(|| at.to_owned())?;
    for (index, rule) in rules.iter().enumerate() {
        let at = format!("{at}[{index}]");
        let action = rule
            .get("Action")
            .and_then(Json::as_str)
            .unwrap_or_default();
        let shape: (&[Rule], &[Rule]) = match action {
            "Connect" => (
                &[
                    ("Action", any),
                    ("InterfaceTypeMatch", |v| {
                        v == "WiFi" || v == "Cellular" || v == "Ethernet"
                    }),
                ],
                &[],
            ),
            "Disconnect" => (&[("Action", any)], &[("SSIDMatch", strings)]),
            "EvaluateConnection" => (&[("Action", any), ("ActionParameters", never_connect)], &[]),
            _ => return Err(format!("{at}.Action")),
        };
        dict(rule, &at, shape.0, shape.1)?;
    }
    Ok(())
}

fn dns_payload(value: &Json, at: &str) -> Checked {
    dict(
        value,
        at,
        &[
            ("DNSSettings", any),
            ("OnDemandRules", any),
            ("PayloadDescription", string),
            ("PayloadDisplayName", string),
            ("PayloadIdentifier", string),
            ("PayloadType", any),
            ("PayloadUUID", string),
            ("PayloadVersion", version_one),
            ("ProhibitDisablement", boolean),
        ],
        &[],
    )?;
    dns_settings(&value["DNSSettings"], &format!("{at}.DNSSettings"))?;
    on_demand_rules(&value["OnDemandRules"], &format!("{at}.OnDemandRules"))
}

fn declaration(value: &Json, at: &str) -> Checked {
    let kind = value.get("Type").and_then(Json::as_str).unwrap_or_default();
    if !DECLARATION_TYPES.contains(&kind) {
        return Err(format!("{at}.Type"));
    }
    dict(
        value,
        at,
        &[
            ("Type", any),
            ("Identifier", string),
            ("ServerToken", string),
            ("Payload", any),
        ],
        &[],
    )?;
    let payload = &value["Payload"];
    let at = format!("{at}.Payload");
    if kind == "com.apple.activation.simple" {
        dict(payload, &at, &[("StandardConfigurations", strings)], &[])?;
        return Ok(());
    }
    dict(
        payload,
        &at,
        &[
            ("VisibleName", string),
            ("DNSSettings", any),
            ("OnDemandRules", any),
            ("ProhibitDisablement", boolean),
        ],
        &[],
    )?;
    dns_settings(&payload["DNSSettings"], &format!("{at}.DNSSettings"))?;
    on_demand_rules(&payload["OnDemandRules"], &format!("{at}.OnDemandRules"))
}

fn declarations_payload(value: &Json, plist: &Dictionary, at: &str) -> Checked {
    dict(
        value,
        at,
        &[
            ("Declarations", any),
            ("PayloadDescription", string),
            ("PayloadDisplayName", string),
            ("PayloadIdentifier", string),
            ("PayloadType", any),
            ("PayloadUUID", string),
            ("PayloadVersion", version_one),
        ],
        &[],
    )?;
    let at = format!("{at}.Declarations");
    let declarations = plist
        .get("Declarations")
        .and_then(Value::as_array)
        .ok_or_else(|| at.clone())?;
    for (index, data) in declarations.iter().enumerate() {
        let at = format!("{at}[{index}]");
        let json: Json = data
            .as_data()
            .and_then(|data| serde_json::from_slice(data).ok())
            .ok_or_else(|| at.clone())?;
        declaration(&json, &at)?;
    }
    Ok(())
}

/// Exactly the keys and values src/lib/profile.ts writes, at every level.
fn built_by_the_pages(profile: &Value) -> Checked {
    let json = serde_json::to_value(profile).map_err(|_| "profile".to_owned())?;
    dict(
        &json,
        "profile",
        &[
            ("PayloadContent", any),
            ("PayloadDescription", string),
            ("PayloadDisplayName", string),
            ("PayloadIdentifier", string),
            ("PayloadRemovalDisallowed", |v| v == false),
            ("PayloadType", |v| v == "Configuration"),
            ("PayloadUUID", string),
            ("PayloadVersion", version_one),
        ],
        &[("PayloadScope", |v| v == "System")],
    )?;
    let payloads = profile
        .as_dictionary()
        .and_then(|profile| profile.get("PayloadContent"))
        .and_then(Value::as_array)
        .ok_or("profile.PayloadContent")?;
    for (index, payload) in payloads.iter().enumerate() {
        let at = format!("profile.PayloadContent[{index}]");
        let plist = payload.as_dictionary().ok_or_else(|| at.clone())?;
        let value = &json["PayloadContent"][index];
        match payload_type(plist) {
            Some(DNS_PAYLOAD_TYPE) => dns_payload(value, &at)?,
            Some(DECLARATIONS_PAYLOAD_TYPE) => declarations_payload(value, plist, &at)?,
            _ => return Err(format!("{at}.PayloadType")),
        }
    }
    Ok(())
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

/// The plist crate parses nested elements recursively and overflows the stack
/// on deep nesting. Must match MAX_NESTING in src/lib/xml.ts; a test checks
/// both.
const MAX_NESTING: usize = 64;

/// Whether elements in `xml` nest deeper than MAX_NESTING. Comments,
/// declarations, CDATA and processing instructions don't count.
fn nested_too_deeply(xml: &str) -> bool {
    let mut depth = 0usize;
    let mut rest = xml;
    while let Some(at) = rest.find('<') {
        rest = &rest[at..];
        let skip_to = |end: &str| rest.find(end).map_or(rest.len(), |at| at + end.len());
        let next = if rest.starts_with("<!--") {
            skip_to("-->")
        } else if rest.starts_with("<![CDATA[") {
            skip_to("]]>")
        } else if rest.starts_with("<?") {
            skip_to("?>")
        } else if rest.starts_with("<!") {
            skip_to(">")
        } else {
            let end = skip_to(">");
            let tag = &rest[..end];
            if tag.starts_with("</") {
                depth = depth.saturating_sub(1);
            } else if !tag.ends_with("/>") {
                depth += 1;
                if depth > MAX_NESTING {
                    return true;
                }
            }
            end
        };
        rest = &rest[next..];
    }
    false
}

/// Which kind of profile `xml` is: DNS settings as the pages build them, or
/// fonts by Apple's rules. The app saves, shares and signs nothing else.
pub fn check(xml: &str) -> Result<Kind, String> {
    if xml.len() as u64 > MAX_PROFILE_BYTES || nested_too_deeply(xml) {
        return Err(REFUSED.into());
    }
    let parsed = Value::from_reader_xml(xml.as_bytes()).map_err(|_| REFUSED.to_owned())?;
    let Some(profile) = parsed.as_dictionary() else {
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
    if payloads.iter().all(is_dns_payload) {
        return match built_by_the_pages(&parsed) {
            Ok(()) => Ok(Kind::Dns),
            Err(path) => {
                eprintln!("Refused a DNS profile at {path}");
                Err(REFUSED.into())
            }
        };
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

    const FULL: &str = include_str!("../../test/golden/full-surface.mobileconfig");
    const DECLARATIONS: &str = include_str!("../tests/fixtures/declarations.mobileconfig");

    fn refused_at(xml: &str) -> String {
        assert_eq!(check(xml), Err(REFUSED.into()));
        let parsed = Value::from_reader_xml(xml.as_bytes()).unwrap();
        built_by_the_pages(&parsed).unwrap_err()
    }

    fn add_after(xml: &str, anchor: &str, extra: &str) -> String {
        assert!(xml.contains(anchor), "{anchor}");
        xml.replacen(anchor, &format!("{anchor}{extra}"), 1)
    }

    #[test]
    fn refuses_a_key_the_builder_does_not_write_at_any_level() {
        let extra = "<key>Extra</key><string>x</string>";
        for (anchor, path) in [
            ("<plist version=\"1.0\">\n<dict>", "profile.Extra"),
            (
                "<key>DNSSettings</key>\n\t\t\t<dict>",
                "profile.PayloadContent[0].DNSSettings.Extra",
            ),
            (
                "<key>OnDemandRules</key>\n\t\t\t<array>\n\t\t\t\t<dict>",
                "profile.PayloadContent[0].OnDemandRules[0].Extra",
            ),
            (
                "<key>ActionParameters</key>\n\t\t\t\t\t<array>\n\t\t\t\t\t\t<dict>",
                "profile.PayloadContent[0].OnDemandRules[1].ActionParameters",
            ),
        ] {
            assert_eq!(refused_at(&add_after(FULL, anchor, extra)), path);
        }
        let payload = FULL.replacen(
            "<key>PayloadVersion</key>\n\t\t\t<integer>1</integer>",
            &format!("<key>PayloadVersion</key>\n\t\t\t<integer>1</integer>{extra}"),
            1,
        );
        assert_eq!(refused_at(&payload), "profile.PayloadContent[0].Extra");
    }

    #[test]
    fn refuses_keys_that_would_change_what_installing_means() {
        for key in [
            "<key>PayloadCertificateUUID</key><string>x</string>",
            "<key>ConsentText</key><dict><key>default</key><string>x</string></dict>",
            "<key>PayloadExpirationDate</key><date>2030-01-01T00:00:00Z</date>",
        ] {
            let xml = add_after(FULL, "<plist version=\"1.0\">\n<dict>", key);
            assert_eq!(check(&xml), Err(REFUSED.into()), "{key}");
        }
    }

    #[test]
    fn refuses_a_profile_that_cannot_be_removed() {
        let xml = FULL.replace(
            "<key>PayloadRemovalDisallowed</key>\n\t<false/>",
            "<key>PayloadRemovalDisallowed</key>\n\t<true/>",
        );
        assert_ne!(xml, FULL);
        assert_eq!(refused_at(&xml), "profile.PayloadRemovalDisallowed");
    }

    #[test]
    fn refuses_values_the_builder_never_writes() {
        for (from, to, path) in [
            (
                "<string>HTTPS</string>",
                "<string>UDP</string>",
                "profile.PayloadContent[0].DNSSettings.DNSProtocol",
            ),
            (
                "<key>ServerURL</key>",
                "<key>ServerName</key>",
                "profile.PayloadContent[0].DNSSettings.ServerURL (missing)",
            ),
            (
                "<key>AllowFailover</key>\n\t\t\t\t<true/>",
                "<key>AllowFailover</key>\n\t\t\t\t<false/>",
                "profile.PayloadContent[0].DNSSettings.AllowFailover",
            ),
            (
                "<string>NeverConnect</string>",
                "<string>ConnectIfNeeded</string>",
                "profile.PayloadContent[0].OnDemandRules[1].ActionParameters",
            ),
            (
                "<string>WiFi</string>",
                "<string>Any</string>",
                "profile.PayloadContent[0].OnDemandRules[2].InterfaceTypeMatch",
            ),
            (
                "<key>PayloadScope</key>\n\t<string>System</string>",
                "<key>PayloadScope</key>\n\t<string>User</string>",
                "profile.PayloadScope",
            ),
        ] {
            assert!(
                FULL.contains(from) || from.contains("PayloadScope"),
                "{from}"
            );
            assert!(FULL.contains(from), "{from}");
            assert_eq!(refused_at(&FULL.replacen(from, to, 1)), path, "{from}");
        }
    }

    #[test]
    fn refuses_a_declaration_with_a_key_the_builder_does_not_write() {
        let mut profile = Value::from_reader_xml(DECLARATIONS.as_bytes()).unwrap();
        let declarations = profile.as_dictionary_mut().unwrap()["PayloadContent"]
            .as_array_mut()
            .unwrap()[0]
            .as_dictionary_mut()
            .unwrap()["Declarations"]
            .as_array_mut()
            .unwrap();
        let last = declarations.len() - 1;
        let mut json: Json = serde_json::from_slice(declarations[last].as_data().unwrap()).unwrap();
        assert_eq!(json["Type"], "com.apple.configuration.network.dns-settings");
        json["Payload"]["PayloadCertificateUUID"] = "x".into();
        declarations[last] = Value::Data(serde_json::to_vec(&json).unwrap());
        let mut xml = Vec::new();
        profile.to_writer_xml(&mut xml).unwrap();
        assert_eq!(
            refused_at(std::str::from_utf8(&xml).unwrap()),
            format!(
                "profile.PayloadContent[0].Declarations[{last}].Payload.PayloadCertificateUUID"
            )
        );
    }

    #[test]
    fn never_signs_payloads_that_could_watch_people() {
        for kind in [
            "com.apple.security.root",
            "com.apple.security.pkcs12",
            "com.apple.security.scep",
            "com.apple.vpn.managed",
            "com.apple.mdm",
            "com.apple.proxy.http.global",
            "com.apple.dnsProxy.managed",
            "com.apple.webClip.managed",
            "com.apple.wifi.managed",
        ] {
            let instead = FULL.replacen(
                "<string>com.apple.dnsSettings.managed</string>",
                &format!("<string>{kind}</string>"),
                1,
            );
            assert_eq!(check(&instead), Err(REFUSED.into()), "{kind} instead");
            let alongside = add_after(
                FULL,
                "<key>PayloadContent</key>\n\t<array>",
                &format!(
                    "<dict><key>PayloadType</key><string>{kind}</string>\
                     <key>PayloadIdentifier</key><string>a</string>\
                     <key>PayloadUUID</key><string>b</string>\
                     <key>PayloadVersion</key><integer>1</integer></dict>"
                ),
            );
            assert_eq!(check(&alongside), Err(REFUSED.into()), "{kind} alongside");
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
    fn refuses_a_profile_nested_deeper_than_any_it_builds() {
        let nested = |depth: usize| {
            format!(
                "<plist version=\"1.0\">{}<string>x</string>{}</plist>",
                "<dict><key>k</key>".repeat(depth),
                "</dict>".repeat(depth)
            )
        };
        assert!(!nested_too_deeply(&nested(MAX_NESTING - 2)));
        assert!(nested_too_deeply(&nested(MAX_NESTING)));
        assert_eq!(check(&nested(100_000)), Err(REFUSED.into()));
        assert!(!nested_too_deeply(FULL));
        assert!(!nested_too_deeply(
            "<!-- <a><a><a> --><plist><![CDATA[<b><b>]]><true/></plist>"
        ));
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
