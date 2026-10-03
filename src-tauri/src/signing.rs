use std::cmp::Ordering;

use serde::Serialize;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum IdentityStatus {
    Trusted,
    Untrusted,
}

/// The page's `SigningIdentity` in src/desktop/bindings.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct SigningIdentity {
    /// The certificate's SHA-1 fingerprint in uppercase hex. The page
    /// remembers it as the chosen identity.
    pub id: String,
    pub name: String,
    pub status: IdentityStatus,
}

pub struct Signature {
    pub signed: Vec<u8>,
    pub name: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct Unwrapped {
    pub content: Vec<u8>,
    /// Every signature matches the content, trusted or not.
    pub intact: bool,
}

/// The tag a DER signed message starts with. A plain profile starts with `<`.
const SEQUENCE: u8 = 0x30;

fn fingerprint(der: &[u8]) -> String {
    sha1_smol::Sha1::from(der)
        .digest()
        .to_string()
        .to_uppercase()
}

/// Close to the page's localeCompare: case only breaks ties.
fn by_name(a: &SigningIdentity, b: &SigningIdentity) -> Ordering {
    a.name
        .to_lowercase()
        .cmp(&b.name.to_lowercase())
        .then_with(|| a.name.cmp(&b.name))
}

#[cfg(target_os = "macos")]
pub use keychain::{keychain, unwrap_signed};

#[cfg(target_os = "macos")]
mod keychain {
    use security_framework::base::Error;
    use security_framework::certificate::SecCertificate;
    use security_framework::cms::{
        CMS_DIGEST_ALGORITHM_SHA256, CMSDecoder, CMSEncoder, SignedAttributes,
    };
    use security_framework::identity::SecIdentity;
    use security_framework::item::{ItemClass, ItemSearchOptions, Limit, Reference, SearchResult};
    use security_framework::os::macos::keychain::SecKeychain;
    use security_framework::policy::SecPolicy;
    use security_framework::trust::SecTrust;
    use security_framework_sys::base::{
        errSecCertificateRevoked as CERTIFICATE_REVOKED, errSecItemNotFound,
    };
    use security_framework_sys::cms::CMSSignerStatus;

    use super::{
        IdentityStatus, SEQUENCE, Signature, SigningIdentity, Unwrapped, by_name, fingerprint,
    };

    /// errSecCertificateExpired and errSecCertificateNotValidYet, which
    /// security-framework-sys does not name.
    const CERTIFICATE_EXPIRED: i32 = -67818;
    const CERTIFICATE_NOT_VALID_YET: i32 = -67819;

    /// `alone` is the certificate trusted as its own anchor, which leaves
    /// only its dates and revocation to fail: an untrusted certificate
    /// reports that first, whatever its dates.
    pub(super) fn status(
        alone: Result<(), i32>,
        chained: Result<(), i32>,
    ) -> Option<IdentityStatus> {
        let unusable = |result: Result<(), i32>| {
            matches!(
                result,
                Err(CERTIFICATE_EXPIRED | CERTIFICATE_NOT_VALID_YET | CERTIFICATE_REVOKED)
            )
        };
        if unusable(alone) || unusable(chained) {
            return None;
        }
        Some(match chained {
            Ok(()) => IdentityStatus::Trusted,
            Err(_) => IdentityStatus::Untrusted,
        })
    }

    fn evaluate(certificate: &SecCertificate, alone: bool) -> Result<(), i32> {
        let certificates = std::slice::from_ref(certificate);
        let mut trust =
            SecTrust::create_with_certificates(certificates, &[SecPolicy::create_x509()])
                .map_err(Error::code)?;
        trust
            .set_network_fetch_allowed(false)
            .map_err(Error::code)?;
        if alone {
            trust
                .set_anchor_certificates(certificates)
                .map_err(Error::code)?;
        }
        trust
            .evaluate_with_error()
            .map_err(|error| i32::try_from(error.code()).unwrap_or(i32::MIN))
    }

    struct Usable {
        identity: SigningIdentity,
        signer: SecIdentity,
    }

    pub struct Keychain {
        search_list: Vec<SecKeychain>,
    }

    pub fn keychain() -> Keychain {
        Keychain::new(Vec::new())
    }

    impl Keychain {
        /// Searches only `search_list`, or the user's keychains if it is empty.
        pub fn new(search_list: Vec<SecKeychain>) -> Self {
            Self { search_list }
        }

        fn inventory(&self) -> Result<Vec<Usable>, String> {
            let mut search = ItemSearchOptions::new();
            search
                .class(ItemClass::identity())
                .load_refs(true)
                .limit(Limit::All);
            if !self.search_list.is_empty() {
                search.keychains(&self.search_list);
            }
            let found = match search.search() {
                Ok(found) => found,
                Err(error) if error.code() == errSecItemNotFound => Vec::new(),
                Err(error) => return Err(format!("Could not read your Keychain: {error}")),
            };

            let mut usable: Vec<Usable> = Vec::new();
            for result in found {
                let SearchResult::Ref(Reference::Identity(signer)) = result else {
                    continue;
                };
                let Ok(certificate) = signer.certificate() else {
                    continue;
                };
                let id = fingerprint(&certificate.to_der());
                if usable.iter().any(|known| known.identity.id == id) {
                    continue;
                }
                let Some(status) =
                    status(evaluate(&certificate, true), evaluate(&certificate, false))
                else {
                    continue;
                };
                usable.push(Usable {
                    identity: SigningIdentity {
                        id,
                        name: certificate.subject_summary(),
                        status,
                    },
                    signer,
                });
            }
            usable.sort_by(|a, b| by_name(&a.identity, &b.identity));
            Ok(usable)
        }

        pub fn list(&self) -> Result<Vec<SigningIdentity>, String> {
            Ok(self
                .inventory()?
                .into_iter()
                .map(|usable| usable.identity)
                .collect())
        }

        pub fn sign(&self, xml: &str, id: &str) -> Result<Signature, String> {
            let Some(Usable { identity, signer }) = self
                .inventory()?
                .into_iter()
                .find(|usable| usable.identity.id == id)
            else {
                return Err(
                    "That certificate is no longer in your Keychain, or has expired.".into(),
                );
            };

            let signed = encode(&signer, xml.as_bytes()).map_err(|error| {
                format!(
                    "Signing with “{}” failed ({error}). If macOS asked for permission to use \
                     the key, choose Allow.",
                    identity.name
                )
            })?;
            let checks_out = unwrap_signed(&signed)
                .is_some_and(|unwrapped| unwrapped.intact && unwrapped.content == xml.as_bytes());
            if !checks_out {
                return Err("The signed profile did not check out, so it was not saved.".into());
            }
            Ok(Signature {
                signed,
                name: identity.name,
            })
        }
    }

    fn encode(signer: &SecIdentity, content: &[u8]) -> Result<Vec<u8>, Error> {
        let encoder = CMSEncoder::create()?;
        encoder.set_signer_algorithm(CMS_DIGEST_ALGORITHM_SHA256)?;
        encoder.add_signers(std::slice::from_ref(signer))?;
        encoder.add_signed_attributes(SignedAttributes::SIGNING_TIME)?;
        encoder.update_content(content)?;
        encoder.get_encoded_content()
    }

    /// The content of a signed message, `None` for one that is not signed.
    /// One that cannot be read is kept whole, as not intact.
    pub fn unwrap_signed(message: &[u8]) -> Option<Unwrapped> {
        if message.first() != Some(&SEQUENCE) {
            return None;
        }
        Some(decode(message).unwrap_or_else(|| Unwrapped {
            content: message.to_vec(),
            intact: false,
        }))
    }

    fn decode(message: &[u8]) -> Option<Unwrapped> {
        let decoder = CMSDecoder::create().ok()?;
        decoder.update_message(message).ok()?;
        decoder.finalize_message().ok()?;
        let signers = decoder.get_num_signers().ok()?;
        let policy = [SecPolicy::create_x509()];
        let intact = signers > 0
            && (0..signers).all(|index| {
                decoder
                    .get_signer_status(index, &policy)
                    .is_ok_and(|signer| {
                        matches!(
                            signer.signer_status,
                            CMSSignerStatus::kCMSSignerValid
                                | CMSSignerStatus::kCMSSignerInvalidCert
                        )
                    })
            });
        Some(Unwrapped {
            content: decoder.get_content().ok()?,
            intact,
        })
    }
}

#[cfg(not(target_os = "macos"))]
pub fn unwrap_signed(message: &[u8]) -> Option<Unwrapped> {
    (message.first() == Some(&SEQUENCE)).then(|| Unwrapped {
        content: message.to_vec(),
        intact: false,
    })
}

#[cfg(not(target_os = "macos"))]
pub struct Keychain;

#[cfg(not(target_os = "macos"))]
pub fn keychain() -> Keychain {
    Keychain
}

#[cfg(not(target_os = "macos"))]
impl Keychain {
    pub fn list(&self) -> Result<Vec<SigningIdentity>, String> {
        Ok(Vec::new())
    }

    pub fn sign(&self, _xml: &str, _id: &str) -> Result<Signature, String> {
        Err("Signing is only available on macOS.".into())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn identity(name: &str) -> SigningIdentity {
        SigningIdentity {
            id: name.into(),
            name: name.into(),
            status: IdentityStatus::Trusted,
        }
    }

    #[test]
    fn fingerprints_in_the_uppercase_hex_find_identity_showed() {
        assert_eq!(
            fingerprint(b"abc"),
            "A9993E364706816ABA3E25717850C26C9CD0D89D"
        );
    }

    #[test]
    fn sorts_by_name_with_case_only_breaking_ties() {
        let mut all = [identity("Zeta"), identity("alpha"), identity("Alpha")];
        all.sort_by(by_name);
        let names: Vec<_> = all.iter().map(|identity| identity.name.as_str()).collect();
        assert_eq!(names, ["Alpha", "alpha", "Zeta"]);
    }

    #[test]
    fn serializes_identities_as_the_page_expects() {
        let identity = SigningIdentity {
            id: "AB".into(),
            name: "Company Signing".into(),
            status: IdentityStatus::Untrusted,
        };
        assert_eq!(
            serde_json::to_value(identity).unwrap(),
            serde_json::json!({ "id": "AB", "name": "Company Signing", "status": "untrusted" })
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn hides_expired_not_yet_valid_and_revoked_certificates_and_marks_untrusted_ones() {
        use keychain::status;
        const NOT_TRUSTED: i32 = -67843;
        assert_eq!(status(Ok(()), Ok(())), Some(IdentityStatus::Trusted));
        assert_eq!(
            status(Ok(()), Err(NOT_TRUSTED)),
            Some(IdentityStatus::Untrusted)
        );
        for unusable in [-67818, -67819, -67820] {
            assert_eq!(status(Err(unusable), Err(NOT_TRUSTED)), None, "{unusable}");
            assert_eq!(status(Ok(()), Err(unusable)), None, "{unusable}");
        }
    }

    const PLAIN: &[u8] = include_bytes!("../../test/golden/quad9-default-tls.mobileconfig");
    /// PLAIN, signed by `openssl cms -sign` with tests/fixtures/valid.p12.
    const SIGNED: &[u8] = include_bytes!("../tests/fixtures/signed.mobileconfig");

    #[cfg(target_os = "macos")]
    #[test]
    fn unwraps_a_signed_profile_whose_signature_matches() {
        assert_eq!(
            unwrap_signed(SIGNED),
            Some(Unwrapped {
                content: PLAIN.to_vec(),
                intact: true,
            })
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn flags_a_profile_changed_after_signing() {
        let at = SIGNED
            .windows(5)
            .position(|window| window == b"quad9")
            .unwrap();
        let mut changed = SIGNED.to_vec();
        changed[at + 4] = b'8';
        let unwrapped = unwrap_signed(&changed).unwrap();
        assert!(!unwrapped.intact);
        assert_ne!(unwrapped.content, PLAIN);
    }

    #[test]
    fn keeps_a_damaged_signed_profile_whole_and_flags_it() {
        let damaged = &SIGNED[..SIGNED.len() / 2];
        assert_eq!(
            unwrap_signed(damaged),
            Some(Unwrapped {
                content: damaged.to_vec(),
                intact: false,
            })
        );
    }

    #[test]
    fn leaves_an_unsigned_profile_alone() {
        assert_eq!(unwrap_signed(PLAIN), None);
    }

    #[cfg(target_os = "macos")]
    #[test]
    #[ignore = "needs the Keychain, which a sandboxed shell cannot reach"]
    fn lists_and_signs_with_identities_in_a_keychain() {
        use keychain::Keychain;
        use security_framework::os::macos::import_export::ImportOptions;
        use security_framework::os::macos::keychain::SecKeychain;
        use std::process::Command;

        struct Throwaway(std::path::PathBuf);
        impl Drop for Throwaway {
            fn drop(&mut self) {
                let _ = Command::new("/usr/bin/security")
                    .arg("delete-keychain")
                    .arg(&self.0)
                    .status();
            }
        }

        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("signing-test.keychain-db");
        let created = Command::new("/usr/bin/security")
            .args(["create-keychain", "-p", "test"])
            .arg(&path)
            .status()
            .unwrap();
        assert!(created.success());
        let _guard = Throwaway(path.clone());
        let mut test_keychain = SecKeychain::open(&path).unwrap();
        test_keychain.unlock(Some("test")).unwrap();
        for (name, p12) in [
            (
                "valid.p12",
                &include_bytes!("../tests/fixtures/valid.p12")[..],
            ),
            (
                "expired.p12",
                include_bytes!("../tests/fixtures/expired.p12"),
            ),
            ("future.p12", include_bytes!("../tests/fixtures/future.p12")),
        ] {
            ImportOptions::new()
                .filename(name)
                .passphrase("test")
                .keychain(&test_keychain)
                .import(p12)
                .unwrap();
        }
        let keychain = Keychain::new(vec![test_keychain]);

        let listed = keychain.list().unwrap();
        assert_eq!(
            listed,
            [SigningIdentity {
                id: "A99155E1588E5A52B88194E4FE034C53E2EC8DB6".into(),
                name: "DNS Test Valid".into(),
                status: IdentityStatus::Untrusted,
            }]
        );

        let xml = "<plist>profile</plist>";
        let signature = keychain.sign(xml, &listed[0].id).unwrap();
        assert_eq!(signature.name, "DNS Test Valid");
        let signed = folder.path().join("signed.mobileconfig");
        std::fs::write(&signed, &signature.signed).unwrap();
        let decoded = Command::new("/usr/bin/security")
            .args(["cms", "-D", "-i"])
            .arg(&signed)
            .output()
            .unwrap();
        assert_eq!(decoded.stdout, xml.as_bytes());

        let error = keychain.sign(xml, "0000").err().unwrap();
        assert!(error.contains("no longer in your Keychain"), "{error}");
    }
}
