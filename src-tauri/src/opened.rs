use std::collections::VecDeque;
use std::fs::File;
use std::io::Read;
use std::path::Path;
#[cfg(any(target_os = "macos", test))]
use std::path::PathBuf;
use std::sync::Mutex;

use serde::Serialize;
#[cfg(any(target_os = "macos", test))]
use tauri::Url;

use crate::signing::{SEQUENCE, unwrap_signed};

/// Must match `OPENED_EVENT` in src/ui/desktop.ts; a test checks both.
pub const OPENED_EVENT: &str = "profiles-opened";

/// Far above any real profile, which is a few kilobytes.
pub const MAX_PROFILE_BYTES: u64 = 5 * 1024 * 1024;

/// The page's `OpenedProfile` in src/desktop/bindings.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OpenedProfile {
    pub name: String,
    /// Decoded as the page decodes a dropped file.
    pub text: String,
}

#[derive(Debug, PartialEq, Eq)]
pub struct ReadProfile {
    pub profile: OpenedProfile,
    pub broken_signature: bool,
}

#[derive(Default)]
pub struct OpenedProfiles(Mutex<VecDeque<OpenedProfile>>);

impl OpenedProfiles {
    pub fn push(&self, profile: OpenedProfile) {
        if let Ok(mut queue) = self.0.lock() {
            queue.push_back(profile);
        }
    }

    pub fn take(&self) -> Option<OpenedProfile> {
        self.0.lock().ok()?.pop_front()
    }
}

#[cfg(any(target_os = "macos", test))]
pub fn file_paths(urls: &[Url]) -> Vec<PathBuf> {
    urls.iter()
        .filter(|url| url.scheme() == "file")
        .filter_map(|url| url.to_file_path().ok())
        .collect()
}

pub fn read_profile(path: &Path) -> Result<ReadProfile, String> {
    let name = path.file_name().map_or_else(
        || path.display().to_string(),
        |name| name.to_string_lossy().into_owned(),
    );
    let failed = |reason: &str| could_not_open(&name, reason);

    let file = File::open(path).map_err(|error| failed(&error.to_string()))?;
    let metadata = file
        .metadata()
        .map_err(|error| failed(&error.to_string()))?;
    if !metadata.is_file() {
        return Err(failed("It is not a file."));
    }
    let mut bytes = Vec::new();
    // One byte over the limit, to catch a file that grew since `metadata`.
    file.take(MAX_PROFILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| failed(&error.to_string()))?;
    if metadata.len() > MAX_PROFILE_BYTES || bytes.len() as u64 > MAX_PROFILE_BYTES {
        return Err(failed(TOO_LARGE));
    }
    unwrap_profile(name, bytes)
}

/// A profile dropped on the page, checked as `read_profile` checks an opened one.
pub fn read_dropped(name: String, bytes: Vec<u8>) -> Result<ReadProfile, String> {
    if bytes.len() as u64 > MAX_PROFILE_BYTES {
        return Err(could_not_open(&name, TOO_LARGE));
    }
    unwrap_profile(name, bytes)
}

const TOO_LARGE: &str = "It is too large to be a configuration profile.";
const NOT_A_PROFILE: &str = "It is not a configuration profile.";

#[derive(Debug, PartialEq, Eq)]
enum Kind {
    Plain,
    Signed,
    Neither,
}

/// What a file holds, by its first byte after an optional UTF-8 BOM and
/// whitespace. Anything in front of a signed message breaks its signature, so
/// it still counts as signed. Must match `fileKind` in src/ui/dropzone.ts; the
/// tests use the same cases.
fn kind(bytes: &[u8]) -> Kind {
    let rest = bytes.strip_prefix(b"\xef\xbb\xbf").unwrap_or(bytes);
    match rest
        .iter()
        .find(|byte| !matches!(byte, b' ' | b'\t' | b'\n' | b'\r'))
    {
        Some(b'<') => Kind::Plain,
        Some(&byte) if byte == SEQUENCE => Kind::Signed,
        _ => Kind::Neither,
    }
}

fn could_not_open(name: &str, reason: &str) -> String {
    format!("Could not open “{name}”.\n\n{reason}")
}

fn unwrap_profile(name: String, bytes: Vec<u8>) -> Result<ReadProfile, String> {
    let (bytes, broken_signature) = match kind(&bytes) {
        Kind::Neither => return Err(could_not_open(&name, NOT_A_PROFILE)),
        Kind::Plain => (bytes, false),
        // A signed message with something in front doesn't decode: broken.
        Kind::Signed => match unwrap_signed(&bytes) {
            Some(unwrapped) => (unwrapped.content, !unwrapped.intact),
            None => (bytes, true),
        },
    };
    Ok(ReadProfile {
        profile: OpenedProfile {
            name,
            text: String::from_utf8_lossy(&bytes).into_owned(),
        },
        broken_signature,
    })
}

#[cfg(test)]
mod tests {
    use std::fs;

    use super::*;

    #[test]
    fn reads_the_name_and_text() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("Quad9 ü.mobileconfig");
        fs::write(&path, "<plist>profile</plist>").unwrap();
        assert_eq!(
            read_profile(&path),
            Ok(ReadProfile {
                profile: OpenedProfile {
                    name: "Quad9 ü.mobileconfig".into(),
                    text: "<plist>profile</plist>".into(),
                },
                broken_signature: false,
            })
        );
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn reads_the_profile_inside_a_signed_one() {
        let read = read_profile("tests/fixtures/signed.mobileconfig".as_ref()).unwrap();
        assert!(!read.broken_signature);
        assert!(
            read.profile.text.starts_with("<?xml"),
            "{:.40}",
            read.profile.text
        );
        assert!(read.profile.text.ends_with("</plist>\n"));
    }

    #[test]
    fn keeps_the_plist_of_a_damaged_signed_profile_and_flags_it() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("signed.mobileconfig");
        let mut bytes = vec![0x30, 0x82, 0xff, 0xfe];
        bytes.extend_from_slice(b"<plist>profile</plist>");
        bytes.extend_from_slice(&[0xa0, 0x00]);
        fs::write(&path, bytes).unwrap();
        let read = read_profile(&path).unwrap();
        assert!(read.broken_signature);
        assert!(
            read.profile.text.contains("<plist>profile</plist>"),
            "{:?}",
            read.profile.text
        );
    }

    #[test]
    fn explains_a_file_it_cannot_read() {
        let folder = tempfile::tempdir().unwrap();

        let missing = read_profile(&folder.path().join("gone.mobileconfig")).unwrap_err();
        assert!(missing.starts_with("Could not open “gone.mobileconfig”.\n\n"));
        assert!(!missing.contains(&*folder.path().to_string_lossy()));

        let directory = folder.path().join("folder.mobileconfig");
        fs::create_dir(&directory).unwrap();
        assert_eq!(
            read_profile(&directory),
            Err("Could not open “folder.mobileconfig”.\n\nIt is not a file.".into())
        );
    }

    #[test]
    fn refuses_a_file_too_large_to_be_a_profile() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("huge.mobileconfig");
        let file = File::create(&path).unwrap();
        file.set_len(MAX_PROFILE_BYTES + 1).unwrap();
        let error = read_profile(&path).unwrap_err();
        assert!(error.ends_with("It is too large to be a configuration profile."));
    }

    /// tests/fixtures/signed.mobileconfig, signed by `openssl cms -sign`.
    const SIGNED: &[u8] = include_bytes!("../tests/fixtures/signed.mobileconfig");

    #[cfg(target_os = "macos")]
    #[test]
    fn opens_an_intact_dropped_profile_without_a_question() {
        let read = read_dropped("signed.mobileconfig".into(), SIGNED.to_vec()).unwrap();
        assert!(!read.broken_signature);
        assert!(read.profile.text.starts_with("<?xml"));
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn catches_a_dropped_profile_changed_after_signing() {
        let at = SIGNED
            .windows(5)
            .position(|window| window == b"quad9")
            .unwrap();
        let mut changed = SIGNED.to_vec();
        changed[at + 4] = b'8';
        let read = read_dropped("signed.mobileconfig".into(), changed).unwrap();
        assert!(read.broken_signature);
        assert!(read.profile.text.contains("quad8"));
    }

    #[test]
    fn flags_a_damaged_dropped_profile_and_leaves_a_plain_one_alone() {
        let damaged = read_dropped("a.mobileconfig".into(), SIGNED[..SIGNED.len() / 2].to_vec());
        assert!(damaged.unwrap().broken_signature);
        let plain = read_dropped("b.mobileconfig".into(), b"<plist>profile</plist>".to_vec());
        assert_eq!(
            plain,
            Ok(ReadProfile {
                profile: OpenedProfile {
                    name: "b.mobileconfig".into(),
                    text: "<plist>profile</plist>".into(),
                },
                broken_signature: false,
            })
        );
    }

    #[test]
    fn catches_a_signed_profile_with_anything_in_front() {
        for prefix in [&b"\xef\xbb\xbf"[..], b"\n", b"  \r\n"] {
            let bytes = [prefix, SIGNED].concat();
            let read = read_dropped("edited.mobileconfig".into(), bytes).unwrap();
            assert!(read.broken_signature, "{prefix:?}");
        }
    }

    #[test]
    fn refuses_a_file_that_is_neither_plain_nor_signed() {
        let junk = [&b"junk"[..], SIGNED].concat();
        assert_eq!(
            read_dropped("junk.mobileconfig".into(), junk),
            Err("Could not open “junk.mobileconfig”.\n\nIt is not a configuration profile.".into())
        );
        assert!(read_dropped("empty.mobileconfig".into(), Vec::new()).is_err());
    }

    #[test]
    fn reads_a_plain_profile_saved_with_a_byte_order_mark() {
        let bytes = b"\xef\xbb\xbf\n<plist>profile</plist>".to_vec();
        let read = read_dropped("bom.mobileconfig".into(), bytes).unwrap();
        assert!(!read.broken_signature);
        assert!(read.profile.text.ends_with("<plist>profile</plist>"));
    }

    #[test]
    fn refuses_a_dropped_file_too_large_to_be_a_profile() {
        let bytes = vec![b' '; MAX_PROFILE_BYTES as usize + 1];
        assert_eq!(
            read_dropped("huge.mobileconfig".into(), bytes),
            Err("Could not open “huge.mobileconfig”.\n\nIt is too large to be a configuration profile.".into())
        );
    }

    #[test]
    fn queues_profiles_in_order_and_hands_each_out_once() {
        let queue = OpenedProfiles::default();
        for name in ["a.mobileconfig", "b.mobileconfig"] {
            queue.push(OpenedProfile {
                name: name.into(),
                text: String::new(),
            });
        }
        assert_eq!(queue.take().map(|p| p.name), Some("a.mobileconfig".into()));
        assert_eq!(queue.take().map(|p| p.name), Some("b.mobileconfig".into()));
        assert_eq!(queue.take(), None);
    }

    #[test]
    fn takes_only_local_files_from_opened_urls() {
        let urls = [
            Url::parse("file:///Users/me/Downloads/a%20b.mobileconfig").unwrap(),
            Url::parse("https://example.com/c.mobileconfig").unwrap(),
        ];
        assert_eq!(
            file_paths(&urls),
            [PathBuf::from("/Users/me/Downloads/a b.mobileconfig")]
        );
    }

    #[test]
    fn serializes_as_the_page_expects() {
        let profile = OpenedProfile {
            name: "a.mobileconfig".into(),
            text: "<plist/>".into(),
        };
        assert_eq!(
            serde_json::to_value(profile).unwrap(),
            serde_json::json!({ "name": "a.mobileconfig", "text": "<plist/>" })
        );
    }
}
