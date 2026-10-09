//! Files and folders only the user can read: 600 and 700.

use std::fs;
use std::io::{self, Write};
use std::path::Path;

#[cfg(unix)]
use std::os::unix::fs::{DirBuilderExt, OpenOptionsExt, PermissionsExt};

#[cfg(unix)]
const FILE_MODE: u32 = 0o600;
#[cfg(unix)]
const FOLDER_MODE: u32 = 0o700;

/// Creates `path` and any missing parents as 700, and makes `path` itself 700
/// if it was there already.
pub fn create_dir(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    {
        fs::DirBuilder::new()
            .recursive(true)
            .mode(FOLDER_MODE)
            .create(path)?;
        fs::set_permissions(path, fs::Permissions::from_mode(FOLDER_MODE))
    }
    #[cfg(not(unix))]
    fs::create_dir_all(path)
}

/// Writes `contents` to `path` as 600, an existing file included.
pub fn write(path: &Path, contents: &[u8]) -> io::Result<()> {
    let mut options = fs::OpenOptions::new();
    options.write(true).create(true).truncate(true);
    #[cfg(unix)]
    options.mode(FILE_MODE);
    let mut file = options.open(path)?;
    #[cfg(unix)]
    file.set_permissions(fs::Permissions::from_mode(FILE_MODE))?;
    file.write_all(contents)
}

/// Makes an existing folder 700. A missing one is left missing.
pub fn tighten(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    match fs::set_permissions(path, fs::Permissions::from_mode(FOLDER_MODE)) {
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        result => result,
    }
    #[cfg(not(unix))]
    {
        let _ = path;
        Ok(())
    }
}

#[cfg(all(test, unix))]
pub fn mode(path: &Path) -> u32 {
    fs::metadata(path).unwrap().permissions().mode() & 0o777
}

#[cfg(all(test, unix))]
mod tests {
    use super::*;

    #[test]
    fn creates_folders_only_the_user_can_open() {
        let root = tempfile::tempdir().unwrap();
        let inner = root.path().join("a").join("b");
        create_dir(&inner).unwrap();
        assert_eq!(mode(&root.path().join("a")), 0o700);
        assert_eq!(mode(&inner), 0o700);
    }

    #[test]
    fn closes_a_folder_that_was_open_to_others() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("open");
        fs::create_dir(&folder).unwrap();
        fs::set_permissions(&folder, fs::Permissions::from_mode(0o755)).unwrap();
        create_dir(&folder).unwrap();
        assert_eq!(mode(&folder), 0o700);

        fs::set_permissions(&folder, fs::Permissions::from_mode(0o755)).unwrap();
        tighten(&folder).unwrap();
        assert_eq!(mode(&folder), 0o700);
        tighten(&root.path().join("missing")).unwrap();
    }

    #[test]
    fn writes_files_only_the_user_can_read_even_over_an_open_one() {
        let root = tempfile::tempdir().unwrap();
        let path = root.path().join("file");
        write(&path, b"one").unwrap();
        assert_eq!(mode(&path), 0o600);

        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        write(&path, b"two").unwrap();
        assert_eq!(mode(&path), 0o600);
        assert_eq!(fs::read(&path).unwrap(), b"two");
    }
}
