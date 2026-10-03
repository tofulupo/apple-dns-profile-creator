use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU32, Ordering};

use serde::Deserialize;

use crate::save::profile_filename;

const FOLDER: &str = "dns-profile-creator-share";

static NEXT: AtomicU32 = AtomicU32::new(1);

/// The page's Share button, as its `getBoundingClientRect()` gives it.
#[derive(Clone, Copy, Debug, PartialEq, Deserialize)]
pub struct Anchor {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

pub fn folder() -> PathBuf {
    std::env::temp_dir().join(FOLDER)
}

pub fn write(folder: &Path, requested: &str, contents: &[u8]) -> io::Result<PathBuf> {
    let subfolder = folder.join(NEXT.fetch_add(1, Ordering::Relaxed).to_string());
    fs::create_dir_all(&subfolder)?;
    let path = subfolder.join(profile_filename(requested));
    fs::write(&path, contents)?;
    Ok(path)
}

pub fn clean_up(folder: &Path) {
    match fs::remove_dir_all(folder) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => eprintln!("Could not remove {}: {error}", folder.display()),
    }
}

/// AppKit counts y up from the bottom unless the view is flipped, the page
/// down from the top. CSS pixels are the view's points at the default zoom.
pub fn view_rect(anchor: Anchor, view_height: f64, flipped: bool) -> [f64; 4] {
    let y = if flipped {
        anchor.y
    } else {
        view_height - anchor.y - anchor.height
    };
    [anchor.x, y, anchor.width, anchor.height]
}

#[cfg(target_os = "macos")]
pub fn show(window: &tauri::WebviewWindow, path: PathBuf, anchor: Anchor) -> Result<(), String> {
    window
        .with_webview(move |webview| {
            if let Err(error) = picker::show(webview.inner(), &path, anchor) {
                eprintln!("Could not open the share menu: {error}");
            }
        })
        .map_err(|error| error.to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn show(_window: &tauri::WebviewWindow, _path: PathBuf, _anchor: Anchor) -> Result<(), String> {
    Err("Sharing is only available on macOS.".into())
}

#[cfg(target_os = "macos")]
mod picker {
    use std::cell::RefCell;
    use std::ffi::c_void;
    use std::path::Path;

    use objc2::rc::Retained;
    use objc2::{AnyThread, MainThreadMarker};
    use objc2_app_kit::{NSSharingServicePicker, NSView};
    use objc2_foundation::{NSArray, NSPoint, NSRect, NSRectEdge, NSSize, NSString, NSURL};

    use super::{Anchor, view_rect};

    thread_local! {

        static SHOWN: RefCell<Option<Retained<NSSharingServicePicker>>> =
            const { RefCell::new(None) };
    }

    pub fn show(webview: *mut c_void, path: &Path, anchor: Anchor) -> Result<(), String> {
        if MainThreadMarker::new().is_none() {
            return Err("not on the main thread".into());
        }
        if webview.is_null() {
            return Err("the window has no webview".into());
        }
        let path = path.to_str().ok_or("the file's path is not UTF-8")?;
        // SAFETY: Tauri hands over the window's live WKWebView, an NSView,
        // on the main thread (checked above), where it stays valid for the
        // duration of this call.
        let view: &NSView = unsafe { &*webview.cast::<NSView>() };

        let url = NSURL::fileURLWithPath(&NSString::from_str(path));
        // SAFETY: an array of NSURLs is an array of objects; arrays only
        // hand their items out, so viewing them as any object is sound.
        let items: Retained<NSArray> =
            unsafe { Retained::cast_unchecked(NSArray::from_retained_slice(&[url])) };
        // SAFETY: the items are NSURLs, which AppKit can share.
        let picker = unsafe {
            NSSharingServicePicker::initWithItems(NSSharingServicePicker::alloc(), &items)
        };

        let [x, y, width, height] = view_rect(anchor, view.bounds().size.height, view.isFlipped());
        let rect = NSRect::new(NSPoint::new(x, y), NSSize::new(width, height));
        // Below the button, which in an unflipped view is its lower y.
        let below = if view.isFlipped() {
            NSRectEdge::MaxY
        } else {
            NSRectEdge::MinY
        };
        picker.showRelativeToRect_ofView_preferredEdge(rect, view, below);
        SHOWN.with(|shown| *shown.borrow_mut() = Some(picker));
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    const ANCHOR: Anchor = Anchor {
        x: 40.0,
        y: 600.0,
        width: 200.0,
        height: 36.0,
    };

    #[test]
    fn keeps_the_pages_coordinates_in_a_flipped_view() {
        assert_eq!(view_rect(ANCHOR, 800.0, true), [40.0, 600.0, 200.0, 36.0]);
    }

    #[test]
    fn counts_from_the_bottom_in_an_unflipped_view() {
        assert_eq!(view_rect(ANCHOR, 800.0, false), [40.0, 164.0, 200.0, 36.0]);
    }

    #[test]
    fn writes_each_share_to_its_own_subfolder_under_a_profile_name() {
        let temp = tempfile::tempdir().unwrap();
        let first = write(temp.path(), "../a.mobileconfig", b"one").unwrap();
        let second = write(temp.path(), "a.mobileconfig", b"two").unwrap();
        assert_ne!(first.parent(), second.parent());
        for path in [&first, &second] {
            assert_eq!(path.file_name().unwrap(), "a.mobileconfig");
            assert!(path.starts_with(temp.path()));
        }
        assert_eq!(fs::read(&first).unwrap(), b"one");
        assert_eq!(fs::read(&second).unwrap(), b"two");
    }

    #[test]
    fn cleans_up_everything_and_a_missing_folder_quietly() {
        let temp = tempfile::tempdir().unwrap();
        let folder = temp.path().join(FOLDER);
        write(&folder, "a.mobileconfig", b"x").unwrap();
        clean_up(&folder);
        assert!(!folder.exists());
        clean_up(&folder);
    }
}
