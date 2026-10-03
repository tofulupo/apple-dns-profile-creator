use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};

const EXTENSION: &str = ".mobileconfig";
const FALLBACK_STEM: &str = "profile";
/// Far more than anyone needs; stops a runaway loop in a pathological folder.
const MAX_ATTEMPTS: u32 = 1000;

pub fn profile_filename(requested: &str) -> String {
    let base = requested.rsplit(['/', '\\']).next().unwrap_or_default();
    let cleaned: String = base
        .chars()
        .filter(|&c| !c.is_ascii_control() && c != ':')
        .collect();
    let trimmed = cleaned.trim();
    let without_extension = trimmed
        .len()
        .checked_sub(EXTENSION.len())
        .and_then(|start| Some((trimmed.get(..start)?, trimmed.get(start..)?)))
        .filter(|(_, extension)| extension.eq_ignore_ascii_case(EXTENSION))
        .map_or(trimmed, |(stem, _)| stem);

    let stem = without_extension.trim().trim_start_matches('.');
    format!(
        "{}{EXTENSION}",
        if stem.is_empty() { FALLBACK_STEM } else { stem }
    )
}

pub fn numbered_filename(filename: &str, n: u32) -> String {
    if n <= 1 {
        return filename.to_owned();
    }
    let stem = filename.strip_suffix(EXTENSION).unwrap_or(filename);
    format!("{stem} {n}{EXTENSION}")
}

pub fn save_without_overwrite(
    folder: &Path,
    requested: &str,
    contents: &[u8],
) -> io::Result<PathBuf> {
    fs::create_dir_all(folder)?;
    let filename = profile_filename(requested);

    for n in 1..=MAX_ATTEMPTS {
        let path = folder.join(numbered_filename(&filename, n));

        match OpenOptions::new().write(true).create_new(true).open(&path) {
            Ok(mut file) => {
                file.write_all(contents)?;
                return Ok(path);
            }
            Err(error) if error.kind() == io::ErrorKind::AlreadyExists => {}
            Err(error) => return Err(error),
        }
    }

    Err(io::Error::other(format!(
        "No free file name left for {filename} in {}.",
        folder.display()
    )))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn keeps_a_plain_name_that_already_has_the_extension() {
        assert_eq!(
            profile_filename("encrypted-dns.mobileconfig"),
            "encrypted-dns.mobileconfig"
        );
    }

    #[test]
    fn adds_the_extension_whatever_the_case_of_an_existing_one() {
        assert_eq!(profile_filename("quad9"), "quad9.mobileconfig");
        assert_eq!(profile_filename("quad9.MobileConfig"), "quad9.mobileconfig");
    }

    #[test]
    fn drops_any_folder_part_so_the_page_cannot_pick_the_location() {
        assert_eq!(
            profile_filename("../../.ssh/authorized_keys"),
            "authorized_keys.mobileconfig"
        );
        assert_eq!(profile_filename("/etc/x.mobileconfig"), "x.mobileconfig");
        assert_eq!(
            profile_filename("C:\\Users\\x.mobileconfig"),
            "x.mobileconfig"
        );
    }

    #[test]
    fn removes_characters_macos_file_names_cannot_hold_and_leading_dots() {
        assert_eq!(
            profile_filename("a:b\u{0}c\u{1F}d\u{7F}"),
            "abcd.mobileconfig"
        );
        assert_eq!(profile_filename("..hidden"), "hidden.mobileconfig");
    }

    #[test]
    fn falls_back_to_a_default_for_a_name_with_nothing_left() {
        for name in ["", "   ", ".mobileconfig", "/", "..", "::"] {
            assert_eq!(profile_filename(name), "profile.mobileconfig", "{name:?}");
        }
    }

    #[test]
    fn keeps_spaces_and_non_ascii_text_inside_the_name() {
        assert_eq!(
            profile_filename("Mein Profil ü.mobileconfig"),
            "Mein Profil ü.mobileconfig"
        );

        assert_eq!(profile_filename("ü"), "ü.mobileconfig");
        assert_eq!(profile_filename("üüüüüüü"), "üüüüüüü.mobileconfig");
    }

    #[test]
    fn numbers_copies_the_way_finder_does() {
        let name = "encrypted-dns.mobileconfig";
        assert_eq!(numbered_filename(name, 1), name);
        assert_eq!(numbered_filename(name, 2), "encrypted-dns 2.mobileconfig");
        assert_eq!(numbered_filename(name, 10), "encrypted-dns 10.mobileconfig");
    }

    #[test]
    fn writes_the_contents_under_the_requested_name() {
        let folder = tempfile::tempdir().unwrap();
        let path = save_without_overwrite(folder.path(), "a.mobileconfig", b"<x/>").unwrap();
        assert_eq!(path, folder.path().join("a.mobileconfig"));
        assert_eq!(fs::read_to_string(path).unwrap(), "<x/>");
    }

    #[test]
    fn never_replaces_an_existing_file_numbering_new_ones_instead() {
        let folder = tempfile::tempdir().unwrap();
        let original = folder.path().join("a.mobileconfig");
        fs::write(&original, "original").unwrap();
        let second = save_without_overwrite(folder.path(), "a.mobileconfig", b"2").unwrap();
        let third = save_without_overwrite(folder.path(), "a.mobileconfig", b"3").unwrap();

        assert_eq!(second, folder.path().join("a 2.mobileconfig"));
        assert_eq!(third, folder.path().join("a 3.mobileconfig"));
        assert_eq!(fs::read_to_string(original).unwrap(), "original");
        assert_eq!(fs::read_to_string(third).unwrap(), "3");
    }

    #[test]
    fn creates_the_folder_when_it_does_not_exist() {
        let folder = tempfile::tempdir().unwrap();
        let missing = folder.path().join("Downloads");
        let path = save_without_overwrite(&missing, "a", b"<x/>").unwrap();
        assert_eq!(path, missing.join("a.mobileconfig"));
    }

    #[test]
    fn stays_inside_the_folder_whatever_name_it_is_given() {
        let folder = tempfile::tempdir().unwrap();
        let path = save_without_overwrite(folder.path(), "../escape", b"<x/>").unwrap();
        assert_eq!(path, folder.path().join("escape.mobileconfig"));
    }
}
