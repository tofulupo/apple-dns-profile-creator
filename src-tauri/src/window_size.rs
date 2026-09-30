//! The window's size between launches, in logical pixels.
//!
//! The same file and format as earlier versions, built with `deno desktop`,
//! so an existing saved size carries over. Size only, not position: a saved position can point at a display that is
//! no longer connected, and the window would then open out of sight.
//!
//! Not tauri-plugin-window-state: it saves physical pixels, so a size saved
//! on a Retina display opens twice as large on a standard one.

use std::fs;
use std::io;
use std::path::Path;

use serde::Serialize;
use serde_json::Value;

/// In the app's config folder, `~/Library/Application Support/<identifier>`.
pub const FILENAME: &str = "window.json";

/// Keeps a corrupt or hand-edited file from opening a sliver or a giant.
const MIN_DIMENSION: f64 = 240.0;
const MAX_DIMENSION: f64 = 10_000.0;

/// Only made through `new` or `load`, so it is always in range and a size
/// that would be refused on loading can never be saved.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct WindowSize {
    width: u32,
    height: u32,
}

fn dimension(value: f64) -> Option<u32> {
    (MIN_DIMENSION..=MAX_DIMENSION)
        .contains(&value)
        .then(|| value.round() as u32)
}

impl WindowSize {
    /// Rounded to whole pixels; None when either side is out of range.
    pub fn new(width: f64, height: f64) -> Option<Self> {
        Some(Self {
            width: dimension(width)?,
            height: dimension(height)?,
        })
    }

    pub fn logical(self) -> tauri::LogicalSize<u32> {
        tauri::LogicalSize::new(self.width, self.height)
    }

    /// Not a derived `Deserialize`: that would also accept `[900, 840]`.
    fn parse(text: &str) -> Option<Self> {
        let Value::Object(saved) = serde_json::from_str(text).ok()? else {
            return None;
        };
        Self::new(
            saved.get("width")?.as_f64()?,
            saved.get("height")?.as_f64()?,
        )
    }
}

/// The size saved at `path`, or None when there is none or it is unusable.
/// Never fails: a bad file must not stop the app from starting.
pub fn load(path: &Path) -> Option<WindowSize> {
    WindowSize::parse(&fs::read_to_string(path).ok()?)
}

/// Saves `size` to `path`, creating its folder. Written via a temporary file,
/// so a crash never leaves half a file behind.
pub fn save(path: &Path, size: WindowSize) -> io::Result<()> {
    if let Some(folder) = path.parent() {
        fs::create_dir_all(folder)?;
    }
    let temporary = path.with_extension("json.tmp");
    fs::write(&temporary, format!("{}\n", serde_json::to_string(&size)?))?;
    fs::rename(&temporary, path)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_what_the_deno_build_writes() {
        assert_eq!(
            WindowSize::parse("{\"width\":900,\"height\":840}\n"),
            Some(WindowSize {
                width: 900,
                height: 840
            })
        );
    }

    #[test]
    fn rounds_and_ignores_other_fields() {
        assert_eq!(
            WindowSize::parse(r#"{"width":900.6,"height":840.2,"x":5}"#),
            Some(WindowSize {
                width: 901,
                height: 840
            })
        );
    }

    #[test]
    fn rejects_sizes_out_of_range_or_of_the_wrong_shape() {
        for text in [
            r#"{"width":100,"height":840}"#,
            r#"{"width":900,"height":20000}"#,
            r#"{"width":"900","height":840}"#,
            r#"{"width":900}"#,
            "[900,840]",
            "not json",
            "",
        ] {
            assert_eq!(WindowSize::parse(text), None, "{text:?}");
        }
        assert_eq!(WindowSize::new(f64::NAN, 840.0), None);
    }

    #[test]
    fn saves_and_loads_creating_the_folder() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("missing").join(FILENAME);
        let size = WindowSize {
            width: 1000,
            height: 700,
        };
        save(&path, size).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "{\"width\":1000,\"height\":700}\n"
        );
        assert_eq!(load(&path), Some(size));
    }

    #[test]
    fn leaves_no_temporary_file_behind() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join(FILENAME);
        save(&path, WindowSize::new(1100.0, 700.0).unwrap()).unwrap();
        save(&path, WindowSize::new(1000.0, 700.0).unwrap()).unwrap();
        let names: Vec<_> = fs::read_dir(folder.path())
            .unwrap()
            .map(|entry| entry.unwrap().file_name())
            .collect();
        assert_eq!(names, [FILENAME]);
    }

    #[test]
    fn loads_nothing_from_a_missing_file() {
        let folder = tempfile::tempdir().unwrap();
        assert_eq!(load(&folder.path().join(FILENAME)), None);
    }
}
