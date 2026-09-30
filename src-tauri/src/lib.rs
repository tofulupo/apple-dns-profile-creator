//! Tauri desktop app: shows the static site from dist/ in a native window.
//!
//! The commands the page calls are declared in src/desktop/bindings.ts and
//! wrapped for the page in src/ui/desktop.ts.

mod certificate;
mod dialog;
mod save;
mod signing;
mod window_size;

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::window::Color;
use tauri::{AppHandle, Manager, PhysicalSize, RunEvent, WebviewWindow, WindowEvent};
use tauri_plugin_dialog::MessageDialogButtons;
use tauri_plugin_opener::OpenerExt;

use crate::dialog::{alert, show};
use crate::signing::SigningIdentity;
use crate::window_size::WindowSize;

/// The window starts hidden (see tauri.conf.json) and is shown by the page's
/// `page_ready`. After this long it is shown anyway, in case the page fails
/// before it can say so.
const SHOW_ANYWAY_AFTER: Duration = Duration::from_secs(3);

/// Whether the window has been shown, so neither a later page nor the
/// fallback shows it again after the user has minimized or hidden it.
#[derive(Default)]
struct Shown(AtomicBool);

/// The window's latest size, saved when the app quits.
#[derive(Default)]
struct LastSize(Mutex<Option<WindowSize>>);

fn show_once(window: &WebviewWindow) -> tauri::Result<()> {
    if window.state::<Shown>().0.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    window.show()?;
    window.set_focus()
}

/// Called by each page once its styles apply, and whenever its background
/// changes, with that background colour.
///
/// A hidden webview paints nothing, so the page's first frame only comes after
/// the window is shown. Until then the webview shows its own background, white
/// by default; given the page's colour instead, that frame is indistinguishable
/// from the page. The colour also shows when scrolling past the page's ends,
/// hence the updates.
#[tauri::command]
fn page_ready(window: WebviewWindow, background: Option<[u8; 3]>) -> Result<(), String> {
    if let Some([red, green, blue]) = background {
        window
            .set_background_color(Some(Color(red, green, blue, 255)))
            .map_err(|error| error.to_string())?;
    }
    show_once(&window).map_err(|error| error.to_string())
}

/// Runs `work` off the async runtime's threads: it waits on files, on
/// `security`, or on the user answering a Keychain prompt.
async fn blocking<T: Send + 'static>(
    work: impl FnOnce() -> Result<T, String> + Send + 'static,
) -> Result<T, String> {
    tauri::async_runtime::spawn_blocking(work)
        .await
        .map_err(|error| error.to_string())?
}

/// Identities in the Keychain that can sign, expired ones left out.
#[tauri::command]
async fn list_signing_identities() -> Result<Vec<SigningIdentity>, String> {
    blocking(|| signing::keychain().list()).await
}

/// Saves the profile to ~/Downloads under `filename`, numbering it instead of
/// overwriting an existing file, then offers to open it for installation.
/// With `sign_with`, the id of a listed identity, the profile is signed with
/// that Keychain identity first.
#[tauri::command]
async fn save_profile(
    window: WebviewWindow,
    filename: String,
    xml: String,
    sign_with: Option<String>,
) -> Result<(), String> {
    let (contents, signed_by) = match sign_with {
        Some(id) => {
            let signature = blocking(move || signing::keychain().sign(&xml, &id)).await?;
            (signature.signed, Some(signature.name))
        }
        None => (xml.into_bytes(), None),
    };
    let folder = window
        .path()
        .download_dir()
        .map_err(|error| error.to_string())?;
    let path = blocking(move || {
        save::save_without_overwrite(&folder, &filename, &contents)
            .map_err(|error| error.to_string())
    })
    .await?;
    let name = path
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_default();
    let signed = signed_by.map_or_else(
        || ".".to_owned(),
        |signer| format!(", signed with “{signer}”."),
    );

    // Opening a .mobileconfig hands it to System Settings, which is where the
    // profile has to be installed anyway.
    let open = show(
        alert(
            &window,
            &format!(
                "Saved “{name}” to your Downloads folder{signed}\n\nOpen it now? \
                 macOS then asks you to review and install it in System Settings."
            ),
        )
        .buttons(MessageDialogButtons::OkCancelCustom(
            "Open".into(),
            "Not Now".into(),
        )),
    )
    .await?;
    if open
        && let Err(error) = window
            .opener()
            .open_path(path.to_string_lossy(), None::<&str>)
    {
        eprintln!("Could not open {}: {error}", path.display());
        show(
            alert(
                &window,
                &format!(
                    "Could not open “{name}”.\n\nDouble-click it in your Downloads \
                     folder to install it."
                ),
            )
            .buttons(MessageDialogButtons::Ok),
        )
        .await?;
    }
    Ok(())
}

fn window_size_path(app: &AppHandle) -> tauri::Result<PathBuf> {
    Ok(app.path().app_config_dir()?.join(window_size::FILENAME))
}

/// Remembers the window's size as the user resizes it; written on quit.
/// Full screen and minimized are left out, as they are not sizes to reopen at.
fn remember_size(window: &tauri::Window, size: PhysicalSize<u32>) {
    if window.is_fullscreen().unwrap_or(true) || window.is_minimized().unwrap_or(true) {
        return;
    }
    let Ok(scale) = window.scale_factor() else {
        return;
    };
    let logical = size.to_logical::<f64>(scale);
    if let Some(size) = WindowSize::new(logical.width, logical.height)
        && let Ok(mut last) = window.state::<LastSize>().0.lock()
    {
        *last = Some(size);
    }
}

fn save_last_size(app: &AppHandle) {
    let Some(size) = app.state::<LastSize>().0.lock().ok().and_then(|last| *last) else {
        return;
    };
    if let Err(error) = window_size_path(app).and_then(|path| Ok(window_size::save(&path, size)?)) {
        eprintln!("Could not remember the window size: {error}");
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .manage(Shown::default())
        .manage(LastSize::default())
        .setup(|app| {
            let window = app
                .get_webview_window("main")
                .ok_or("tauri.conf.json defines no window labelled main")?;
            if let Some(size) = window_size::load(&window_size_path(app.handle())?) {
                window.set_size(size.logical())?;
            }
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_ANYWAY_AFTER);
                if let Err(error) = show_once(&window) {
                    eprintln!("Could not show the window: {error}");
                }
            });
            Ok(())
        })
        .on_window_event(|window, event| {
            if let WindowEvent::Resized(size) = event {
                remember_size(window, *size);
            }
        })
        .invoke_handler(tauri::generate_handler![
            page_ready,
            list_signing_identities,
            save_profile,
            dialog::ask,
            dialog::tell
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Also after closing the window, since the app then quits.
            if let RunEvent::Exit = event {
                save_last_size(app);
            }
        });
}
