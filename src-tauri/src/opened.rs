use std::collections::VecDeque;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::Url;

use crate::signing::unwrap_signed;

/// Must match `OPENED_EVENT` in src/ui/desktop.ts; a test checks both.
pub const OPENED_EVENT: &str = "profiles-opened";

/// Far above any real profile, which is a few kilobytes.
const MAX_PROFILE_BYTES: u64 = 5 * 1024 * 1024;

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
    let failed = |reason: &str| format!("Could not open “{name}”.\n\n{reason}");

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
        return Err(failed("It is too large to be a configuration profile."));
    }

    let (bytes, broken_signature) = match unwrap_signed(&bytes) {
        Some(unwrapped) => (unwrapped.content, !unwrapped.intact),
        None => (bytes, false),
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
