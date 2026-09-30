//! Profiles the user opens with the app: with Finder's Open With, by dropping
//! them on the Dock icon, or with File > Open Profile….
//!
//! Each is read here and queued; the page takes them one at a time
//! (src/ui/opened.ts) and imports each as if it had been dropped on it. The
//! queue also covers a launch by opening a file, which happens before the page
//! is there to receive it.

use std::collections::VecDeque;
use std::fs::File;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::Url;

/// Emitted to the page whenever profiles are queued. Must match
/// `OPENED_EVENT` in src/ui/desktop.ts; a test checks both.
pub const OPENED_EVENT: &str = "profiles-opened";

/// Far above any real profile, which is a few kilobytes; keeps a wrongly
/// chosen file from being read into memory whole.
const MAX_PROFILE_BYTES: u64 = 5 * 1024 * 1024;

/// A profile as the page receives it: the page's `OpenedProfile` in
/// src/desktop/bindings.ts.
#[derive(Debug, Clone, PartialEq, Eq, Serialize)]
pub struct OpenedProfile {
    /// The file name, shown by the page as what was loaded.
    pub name: String,
    /// The file's content. Decoded as the page decodes a dropped file, so a
    /// signed profile keeps its plist and loses only the binary around it.
    pub text: String,
}

#[derive(Default)]
pub struct OpenedProfiles(Mutex<VecDeque<OpenedProfile>>);

impl OpenedProfiles {
    /// Reads and queues each file. Returns a message for each that could not
    /// be read, for the user.
    pub fn add(&self, paths: &[PathBuf]) -> Vec<String> {
        let (read, failures): (Vec<_>, Vec<_>) = paths
            .iter()
            .map(|path| read_profile(path))
            .partition(Result::is_ok);
        if let Ok(mut queue) = self.0.lock() {
            queue.extend(read.into_iter().flatten());
        }
        failures.into_iter().filter_map(Result::err).collect()
    }

    /// The oldest queued profile, handed out once.
    pub fn take(&self) -> Option<OpenedProfile> {
        self.0.lock().ok()?.pop_front()
    }
}

/// The local files among `urls`, which is how macOS passes opened files.
pub fn file_paths(urls: &[Url]) -> Vec<PathBuf> {
    urls.iter()
        .filter(|url| url.scheme() == "file")
        .filter_map(|url| url.to_file_path().ok())
        .collect()
}

/// Reads `path` for the page, or explains why it could not.
pub fn read_profile(path: &Path) -> Result<OpenedProfile, String> {
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
    // One byte more than allowed, so a file that grew since `metadata` is
    // still caught without reading all of it.
    file.take(MAX_PROFILE_BYTES + 1)
        .read_to_end(&mut bytes)
        .map_err(|error| failed(&error.to_string()))?;
    if metadata.len() > MAX_PROFILE_BYTES || bytes.len() as u64 > MAX_PROFILE_BYTES {
        return Err(failed("It is too large to be a configuration profile."));
    }

    Ok(OpenedProfile {
        name,
        text: String::from_utf8_lossy(&bytes).into_owned(),
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
            Ok(OpenedProfile {
                name: "Quad9 ü.mobileconfig".into(),
                text: "<plist>profile</plist>".into(),
            })
        );
    }

    #[test]
    fn keeps_the_plist_of_a_signed_profile() {
        // A signed profile is binary CMS with the plist inside, as the page's
        // import expects when a file is dropped.
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("signed.mobileconfig");
        let mut bytes = vec![0x30, 0x82, 0xff, 0xfe];
        bytes.extend_from_slice(b"<plist>profile</plist>");
        bytes.extend_from_slice(&[0xa0, 0x00]);
        fs::write(&path, bytes).unwrap();
        let text = read_profile(&path).unwrap().text;
        assert!(text.contains("<plist>profile</plist>"), "{text:?}");
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
    fn queues_readable_files_in_order_and_hands_each_out_once() {
        let folder = tempfile::tempdir().unwrap();
        let first = folder.path().join("a.mobileconfig");
        let second = folder.path().join("b.mobileconfig");
        fs::write(&first, "a").unwrap();
        fs::write(&second, "b").unwrap();
        let missing = folder.path().join("missing.mobileconfig");

        let queue = OpenedProfiles::default();
        let failures = queue.add(&[first, missing, second]);

        assert_eq!(failures.len(), 1);
        assert!(failures[0].contains("missing.mobileconfig"));
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
