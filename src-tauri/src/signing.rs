use std::collections::HashMap;
use std::io::{self, Write};
use std::process::{Command, Stdio};
use std::sync::LazyLock;

use regex::Regex;
use serde::Serialize;

use crate::certificate::{pem_to_der, subject_key_id};

const SECURITY: &str = "/usr/bin/security";

pub struct RunResult {
    pub success: bool,
    pub stdout: Vec<u8>,
    pub stderr: String,
}

pub trait RunSecurity: Fn(&[&str], Option<&[u8]>) -> io::Result<RunResult> + Sync {}

impl<F: Fn(&[&str], Option<&[u8]>) -> io::Result<RunResult> + Sync> RunSecurity for F {}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IdentityStatus {
    Trusted,
    Untrusted,
}

/// The page's `SigningIdentity` in src/desktop/bindings.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SigningIdentity {
    pub id: String,
    pub name: String,
    pub status: IdentityStatus,
}

#[derive(Debug, PartialEq, Eq)]
pub struct KeychainIdentity {
    pub sha1: String,
    pub name: String,
    pub error: Option<String>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Selector {
    KeyId(String),
    Name(String),
}

impl Selector {
    fn args(&self) -> [&str; 2] {
        match self {
            Self::KeyId(key_id) => ["-Z", key_id],
            Self::Name(name) => ["-N", name],
        }
    }
}

#[derive(Debug, PartialEq, Eq)]
pub struct Usable {
    pub identity: SigningIdentity,
    pub selector: Selector,
}

const UNUSABLE: [&str; 3] = [
    "CSSMERR_TP_CERT_EXPIRED",
    "CSSMERR_TP_CERT_NOT_VALID_YET",
    "CSSMERR_TP_CERT_REVOKED",
];

/// A `security find-identity` line: `1) <SHA-1> "<name>" (<CSSMERR_…>)`, the
/// error optional.
static IDENTITY_LINE: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(r#"^\s*\d+\)\s+([0-9A-F]{40})\s+"(.*)"(?:\s+\((\w+)\))?\s*$"#).unwrap()
});

/// A `security find-certificate -Z -p` entry: its SHA-1 and the PEM block after it.
static CERTIFICATE_BLOCK: LazyLock<Regex> = LazyLock::new(|| {
    Regex::new(
        r"SHA-1 hash: ([0-9A-F]{40})\s+(-----BEGIN CERTIFICATE-----(?s:.*?)-----END CERTIFICATE-----)",
    )
    .unwrap()
});

pub fn parse_find_identity(output: &str) -> Vec<KeychainIdentity> {
    let mut found: Vec<KeychainIdentity> = Vec::new();
    for line in output.lines() {
        if line.contains("Valid identities only") {
            break;
        }
        let Some(captures) = IDENTITY_LINE.captures(line) else {
            continue;
        };
        let identity = KeychainIdentity {
            sha1: captures[1].to_owned(),
            name: captures[2].to_owned(),
            error: captures.get(3).map(|error| error.as_str().to_owned()),
        };
        match found.iter_mut().find(|known| known.sha1 == identity.sha1) {
            Some(known) => *known = identity,
            None => found.push(identity),
        }
    }
    found
}

pub fn parse_find_certificate(output: &str) -> HashMap<String, Option<String>> {
    CERTIFICATE_BLOCK
        .captures_iter(output)
        .map(|captures| {
            let key_id = pem_to_der(&captures[2]).and_then(|der| subject_key_id(&der));
            (captures[1].to_owned(), key_id)
        })
        .collect()
}

pub fn usable_identities(
    all: &[KeychainIdentity],
    key_ids: &HashMap<String, Option<String>>,
) -> Vec<Usable> {
    let mut name_counts: HashMap<&str, usize> = HashMap::new();
    for identity in all {
        *name_counts.entry(&identity.name).or_default() += 1;
    }

    let mut usable: Vec<Usable> = all
        .iter()
        .filter(|identity| {
            identity
                .error
                .as_deref()
                .is_none_or(|error| !UNUSABLE.contains(&error))
        })
        .filter_map(|identity| {
            let selector = match key_ids.get(&identity.sha1) {
                Some(Some(key_id)) => Selector::KeyId(key_id.clone()),
                _ if name_counts[identity.name.as_str()] == 1 => {
                    Selector::Name(identity.name.clone())
                }
                _ => return None,
            };
            let status = match identity.error {
                None => IdentityStatus::Trusted,
                Some(_) => IdentityStatus::Untrusted,
            };
            Some(Usable {
                identity: SigningIdentity {
                    id: identity.sha1.clone(),
                    name: identity.name.clone(),
                    status,
                },
                selector,
            })
        })
        .collect();
    // Close to the page's localeCompare: case only breaks ties.
    usable.sort_by(|a, b| {
        let (a, b) = (&a.identity.name, &b.identity.name);
        a.to_lowercase()
            .cmp(&b.to_lowercase())
            .then_with(|| a.cmp(b))
    });
    usable
}

pub fn run_security(args: &[&str], stdin: Option<&[u8]>) -> io::Result<RunResult> {
    let mut child = Command::new(SECURITY)
        .args(args)
        .stdin(if stdin.is_some() {
            Stdio::piped()
        } else {
            Stdio::null()
        })
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    let pipe = child.stdin.take();

    let output = std::thread::scope(|scope| {
        if let (Some(input), Some(mut pipe)) = (stdin, pipe) {
            scope.spawn(move || {
                let _ = pipe.write_all(input);
            });
        }
        child.wait_with_output()
    })?;
    Ok(RunResult {
        success: output.status.success(),
        stdout: output.stdout,
        stderr: String::from_utf8_lossy(&output.stderr).into_owned(),
    })
}

fn last_line(text: &str) -> &str {
    let line = text.trim().lines().last().unwrap_or_default();
    line.strip_prefix("security:").unwrap_or(line).trim_start()
}

pub struct Signature {
    pub signed: Vec<u8>,
    pub name: String,
}

pub struct Keychain<R> {
    run: R,
}

pub fn keychain() -> Keychain<impl RunSecurity> {
    Keychain::new(run_security)
}

impl<R: RunSecurity> Keychain<R> {
    pub fn new(run: R) -> Self {
        Self { run }
    }

    fn inventory(&self) -> Result<Vec<Usable>, String> {
        let (identities, certificates) = std::thread::scope(|scope| {
            let certificates =
                scope.spawn(|| (self.run)(&["find-certificate", "-a", "-Z", "-p"], None));
            let identities = (self.run)(&["find-identity", "-p", "basic"], None);
            (identities, certificates.join())
        });
        let identities =
            identities.map_err(|error| format!("Could not read your Keychain: {error}"))?;
        if !identities.success {
            return Err(format!(
                "Could not read your Keychain: {}",
                last_line(&identities.stderr)
            ));
        }
        let key_ids = match certificates {
            Ok(Ok(certificates)) if certificates.success => {
                parse_find_certificate(&String::from_utf8_lossy(&certificates.stdout))
            }
            _ => HashMap::new(),
        };
        Ok(usable_identities(
            &parse_find_identity(&String::from_utf8_lossy(&identities.stdout)),
            &key_ids,
        ))
    }

    pub fn list(&self) -> Result<Vec<SigningIdentity>, String> {
        Ok(self
            .inventory()?
            .into_iter()
            .map(|usable| usable.identity)
            .collect())
    }

    pub fn sign(&self, xml: &str, id: &str) -> Result<Signature, String> {
        let Some(Usable { identity, selector }) = self
            .inventory()?
            .into_iter()
            .find(|usable| usable.identity.id == id)
        else {
            return Err("That certificate is no longer in your Keychain, or has expired.".into());
        };

        let [flag, value] = selector.args();
        let refused = |details: &str| {
            format!(
                "Signing with “{}” failed ({}). If macOS asked for permission to use \
                 the key, choose Allow.",
                identity.name,
                if details.is_empty() {
                    "no details"
                } else {
                    details
                }
            )
        };
        let signed = (self.run)(
            &["cms", "-S", "-G", "-H", "SHA256", flag, value],
            Some(xml.as_bytes()),
        )
        .map_err(|error| refused(&error.to_string()))?;
        if !signed.success || signed.stdout.is_empty() {
            return Err(refused(last_line(&signed.stderr)));
        }

        let checks_out = (self.run)(&["cms", "-D"], Some(&signed.stdout))
            .is_ok_and(|decoded| decoded.success && decoded.stdout == xml.as_bytes());
        if !checks_out {
            return Err("The signed profile did not check out, so it was not saved.".into());
        }

        Ok(Signature {
            signed: signed.stdout,
            name: identity.name,
        })
    }
}

#[cfg(test)]
mod tests {
    use std::sync::Mutex;

    use super::*;
    use crate::certificate::fixtures::{WITH_SKI, WITHOUT_SKI};

    const A: &str = "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const B: &str = "BBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
    const C: &str = "CCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC";
    const D: &str = "DDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";

    fn find_identity() -> String {
        format!(
            r#"
Policy: X.509 Basic
  Matching identities
  1) {A} "me@example.com" (CSSMERR_TP_CERT_EXPIRED)
  2) {} ".mobileconfig" (CSSMERR_TP_NOT_TRUSTED)
  3) {B} "Company Signing"
  4) {} "Legacy \"quoted\" name" (CSSMERR_TP_NOT_TRUSTED)
     4 identities found

  Valid identities only
  1) {B} "Company Signing"
     1 valid identities found
"#,
            WITH_SKI.sha1, WITHOUT_SKI.sha1
        )
    }

    fn find_certificate() -> String {
        format!(
            "SHA-256 hash: {}\nSHA-1 hash: {}\n{}\nSHA-256 hash: {}\nSHA-1 hash: {}\n{}\n",
            "0".repeat(64),
            WITH_SKI.sha1,
            WITH_SKI.pem,
            "1".repeat(64),
            WITHOUT_SKI.sha1,
            WITHOUT_SKI.pem
        )
    }

    fn identity(sha1: &str, name: &str, error: Option<&str>) -> KeychainIdentity {
        KeychainIdentity {
            sha1: sha1.into(),
            name: name.into(),
            error: error.map(Into::into),
        }
    }

    #[test]
    fn reads_every_identity_once_with_the_verdict_of_macos() {
        assert_eq!(
            parse_find_identity(&find_identity()),
            [
                identity(A, "me@example.com", Some("CSSMERR_TP_CERT_EXPIRED")),
                identity(
                    WITH_SKI.sha1,
                    ".mobileconfig",
                    Some("CSSMERR_TP_NOT_TRUSTED")
                ),
                identity(B, "Company Signing", None),
                identity(
                    WITHOUT_SKI.sha1,
                    r#"Legacy \"quoted\" name"#,
                    Some("CSSMERR_TP_NOT_TRUSTED")
                ),
            ]
        );
    }

    #[test]
    fn finds_nothing_in_an_empty_keychain() {
        assert_eq!(parse_find_identity("  0 identities found\n"), []);
    }

    #[test]
    fn maps_each_fingerprint_to_its_subject_key_identifier_if_any() {
        let key_ids = parse_find_certificate(&find_certificate());
        assert_eq!(key_ids[WITH_SKI.sha1].as_deref(), WITH_SKI.subject_key_id);
        assert_eq!(key_ids.get(WITHOUT_SKI.sha1), Some(&None));
    }

    fn key_ids() -> HashMap<String, Option<String>> {
        HashMap::from([
            (B.into(), Some("B0B0".into())),
            (C.into(), Some("C0C0".into())),
        ])
    }

    #[test]
    fn hides_expired_not_yet_valid_and_revoked_certificates() {
        let all = [
            identity(A, "Old", Some("CSSMERR_TP_CERT_EXPIRED")),
            identity(B, "Future", Some("CSSMERR_TP_CERT_NOT_VALID_YET")),
            identity(C, "Revoked", Some("CSSMERR_TP_CERT_REVOKED")),
        ];
        assert_eq!(usable_identities(&all, &key_ids()), []);
    }

    #[test]
    fn marks_untrusted_ones_sorted_by_name() {
        let all = [
            identity(C, "Zeta", Some("CSSMERR_TP_NOT_TRUSTED")),
            identity(B, "alpha", None),
        ];
        assert_eq!(
            usable_identities(&all, &key_ids()),
            [
                Usable {
                    identity: SigningIdentity {
                        id: B.into(),
                        name: "alpha".into(),
                        status: IdentityStatus::Trusted
                    },
                    selector: Selector::KeyId("B0B0".into()),
                },
                Usable {
                    identity: SigningIdentity {
                        id: C.into(),
                        name: "Zeta".into(),
                        status: IdentityStatus::Untrusted
                    },
                    selector: Selector::KeyId("C0C0".into()),
                },
            ]
        );
    }

    #[test]
    fn falls_back_to_the_name_only_when_it_is_unique_expired_ones_included() {
        let unique = [identity(A, "Only one", None)];
        assert_eq!(
            usable_identities(&unique, &key_ids())[0].selector,
            Selector::Name("Only one".into())
        );

        let clash = [
            identity(A, "Twin", None),
            identity(D, "Twin", Some("CSSMERR_TP_CERT_EXPIRED")),
        ];
        assert_eq!(usable_identities(&clash, &key_ids()), []);
    }

    #[test]
    fn serializes_identities_as_the_page_expects() {
        let identity = SigningIdentity {
            id: B.into(),
            name: "Company Signing".into(),
            status: IdentityStatus::Untrusted,
        };
        assert_eq!(
            serde_json::to_value(identity).unwrap(),
            serde_json::json!({ "id": B, "name": "Company Signing", "status": "untrusted" })
        );
    }

    type Answer = fn(&[&str], Option<&[u8]>) -> Option<RunResult>;

    type Call = (Vec<String>, Option<Vec<u8>>);

    struct FakeSecurity {
        calls: Mutex<Vec<Call>>,
        answer: Answer,
    }

    impl FakeSecurity {
        fn new(answer: Answer) -> Self {
            Self {
                calls: Mutex::default(),
                answer,
            }
        }

        fn run(&self, args: &[&str], stdin: Option<&[u8]>) -> io::Result<RunResult> {
            self.calls.lock().unwrap().push((
                args.iter().map(|&arg| arg.to_owned()).collect(),
                stdin.map(<[u8]>::to_vec),
            ));
            Ok((self.answer)(args, stdin).unwrap_or_else(|| {
                ok(match args[0] {
                    "find-identity" => find_identity().into_bytes(),
                    "find-certificate" => find_certificate().into_bytes(),
                    _ => Vec::new(),
                })
            }))
        }

        fn keychain(&self) -> Keychain<impl RunSecurity> {
            Keychain::new(|args: &[&str], stdin: Option<&[u8]>| self.run(args, stdin))
        }

        fn cms_calls(&self) -> Vec<Call> {
            let calls = self.calls.lock().unwrap();
            calls
                .iter()
                .filter(|(args, _)| args[0] == "cms")
                .cloned()
                .collect()
        }
    }

    fn ok(stdout: Vec<u8>) -> RunResult {
        RunResult {
            success: true,
            stdout,
            stderr: String::new(),
        }
    }

    fn failed(stderr: &str) -> RunResult {
        RunResult {
            success: false,
            stdout: Vec::new(),
            stderr: stderr.into(),
        }
    }

    const XML: &str = "<plist>profile</plist>";
    const SIGNED: &[u8] = &[0x30, 0x82, 0x01, 0x02];

    #[test]
    fn lists_usable_identities_without_their_selectors() {
        let security = FakeSecurity::new(|_, _| None);

        let names: Vec<_> = security
            .keychain()
            .list()
            .unwrap()
            .into_iter()
            .map(|identity| (identity.id, identity.name, identity.status))
            .collect();
        assert_eq!(
            names,
            [
                (
                    WITH_SKI.sha1.into(),
                    ".mobileconfig".into(),
                    IdentityStatus::Untrusted
                ),
                (B.into(), "Company Signing".into(), IdentityStatus::Trusted),
                (
                    WITHOUT_SKI.sha1.into(),
                    r#"Legacy \"quoted\" name"#.into(),
                    IdentityStatus::Untrusted
                ),
            ]
        );
    }

    #[test]
    fn signs_through_stdin_with_the_subject_key_identifier_then_verifies() {
        let security = FakeSecurity::new(|args, _| match args {
            ["cms", "-S", ..] => Some(ok(SIGNED.to_vec())),
            ["cms", "-D"] => Some(ok(XML.as_bytes().to_vec())),
            _ => None,
        });

        let signature = security.keychain().sign(XML, WITH_SKI.sha1).unwrap();

        assert_eq!(signature.signed, SIGNED);
        assert_eq!(signature.name, ".mobileconfig");
        let cms = security.cms_calls();
        let key_id = WITH_SKI.subject_key_id.unwrap();
        assert_eq!(
            cms.iter().map(|(args, _)| args.clone()).collect::<Vec<_>>(),
            [
                vec!["cms", "-S", "-G", "-H", "SHA256", "-Z", key_id],
                vec!["cms", "-D"],
            ]
        );
        assert_eq!(cms[0].1.as_deref(), Some(XML.as_bytes()));
        assert_eq!(cms[1].1.as_deref(), Some(SIGNED));
    }

    #[test]
    fn refuses_an_id_that_is_not_a_usable_identity_before_signing() {
        let security = FakeSecurity::new(|_, _| None);
        let keychain = security.keychain();
        for id in [A, "-N; rm -rf /", ""] {
            let error = keychain.sign("<x/>", id).err().unwrap();
            assert!(error.contains("no longer in your Keychain"), "{error}");
        }
        assert!(security.cms_calls().is_empty());
    }

    #[test]
    fn explains_a_refused_signature_such_as_deny_in_the_keychain_prompt() {
        let security = FakeSecurity::new(|args, _| {
            (args[0] == "cms")
                .then(|| failed("security: problem signing\nsecurity: User canceled\n"))
        });
        let error = security
            .keychain()
            .sign("<x/>", WITH_SKI.sha1)
            .err()
            .unwrap();
        assert!(
            error.contains("Signing with “.mobileconfig” failed (User canceled)"),
            "{error}"
        );
    }

    #[test]
    fn does_not_return_a_signature_whose_content_differs() {
        let security = FakeSecurity::new(|args, _| match args {
            ["cms", "-S", ..] => Some(ok(SIGNED.to_vec())),
            ["cms", "-D"] => Some(ok(b"<plist>something else</plist>".to_vec())),
            _ => None,
        });
        let error = security
            .keychain()
            .sign("<x/>", WITH_SKI.sha1)
            .err()
            .unwrap();
        assert!(error.contains("did not check out"), "{error}");
    }

    #[test]
    fn reports_an_unreadable_keychain() {
        let security = FakeSecurity::new(|_, _| {
            Some(failed("security: SecKeychainSearchCreate: access denied\n"))
        });
        let error = security.keychain().list().err().unwrap();
        assert_eq!(
            error,
            "Could not read your Keychain: SecKeychainSearchCreate: access denied"
        );
    }

    #[test]
    fn feeds_stdin_to_the_real_tool_and_reads_its_output() {
        let result = run_security(&["no-such-command"], Some(b"ignored")).unwrap();
        assert!(!result.success);
        assert!(!result.stderr.is_empty());
    }
}
