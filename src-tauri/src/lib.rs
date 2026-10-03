//! Tauri desktop app: shows the static site from dist/ in a native window.
//!
//! The commands the page calls are declared in src/desktop/bindings.ts and
//! wrapped for the page in src/ui/desktop.ts.

mod certificate;
mod dialog;
mod menu;
mod navigation;
mod opened;
mod save;
mod signing;
mod window_size;

use std::path::PathBuf;
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use tauri::webview::NewWindowResponse;
use tauri::window::Color;
use tauri::{
    AppHandle, Emitter, Manager, PhysicalSize, RunEvent, State, WebviewWindow,
    WebviewWindowBuilder, WindowEvent,
};
use tauri_plugin_dialog::MessageDialogButtons;
use tauri_plugin_opener::OpenerExt;

use crate::dialog::{alert, show};
use crate::opened::{OPENED_EVENT, OpenedProfile, OpenedProfiles};
use crate::signing::SigningIdentity;
use crate::window_size::WindowSize;

/// The app's window, defined in tauri.conf.json and created in `run`.
pub(crate) const MAIN_WINDOW: &str = "main";
/// Settings (⌘,), defined in tauri.conf.json and created when first opened.
pub(crate) const SETTINGS_WINDOW: &str = "settings";

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
    if window.label() == MAIN_WINDOW {
        show_once(&window)
    } else {
        show_if_hidden(&window)
    }
    .map_err(|error| error.to_string())
}

/// Settings is shown each time it opens, but not focused again when its page
/// reports a new background, which a theme chosen elsewhere also causes.
fn show_if_hidden(window: &WebviewWindow) -> tauri::Result<()> {
    if window.is_visible()? {
        return Ok(());
    }
    window.show()?;
    window.set_focus()
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

/// The oldest profile opened with the app that the page has not taken yet.
#[tauri::command]
fn take_opened_profile(opened: State<'_, OpenedProfiles>) -> Option<OpenedProfile> {
    opened.take()
}

/// Queues profiles opened with the app for the page, tells it, and brings the
/// window forward. Reads on its own thread, off the main one; files that
/// cannot be read are reported in an alert each.
pub(crate) fn open_profiles(app: AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        let failures = app.state::<OpenedProfiles>().add(&paths);
        if failures.len() < paths.len() {
            if let Err(error) = app.emit(OPENED_EVENT, ()) {
                eprintln!("Could not tell the page about opened profiles: {error}");
            }
            bring_to_front(&app);
        }
        for message in failures {
            dialog::app_alert(&app, &message)
                .buttons(MessageDialogButtons::Ok)
                .blocking_show();
        }
    });
}

/// Unminimizes and focuses the window, unless it has not been shown yet: on a
/// launch by opening a file, the page shows it once it is ready.
fn bring_to_front(app: &AppHandle) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    if !window.state::<Shown>().0.load(Ordering::SeqCst) {
        return;
    }
    if let Err(error) = window.unminimize().and_then(|()| window.set_focus()) {
        eprintln!("Could not bring the window forward: {error}");
    }
}

/// A window from tauri.conf.json, which only describes it (`"create":
/// false`): the navigation handlers can only be given here.
fn create_window(
    app: &AppHandle,
    label: &str,
) -> Result<WebviewWindow, Box<dyn std::error::Error>> {
    let config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == label)
        .ok_or_else(|| format!("tauri.conf.json defines no window labelled {label}"))?;
    let navigating = app.clone();
    let opening = app.clone();
    Ok(WebviewWindowBuilder::from_config(app, config)?
        .on_navigation(move |url| navigation::allow(&navigating, url))
        .on_new_window(move |url, _| {
            navigation::open_outside(&opening, &url);
            NewWindowResponse::Deny
        })
        .build()?)
}

/// Opens Settings, or brings it forward if it is open. It starts hidden and
/// is shown by its page's `page_ready`, or after a while anyway.
pub(crate) fn open_settings(app: &AppHandle) {
    if let Some(window) = app.get_webview_window(SETTINGS_WINDOW) {
        if let Err(error) = window.show().and_then(|()| window.set_focus()) {
            eprintln!("Could not bring Settings forward: {error}");
        }
        return;
    }
    match create_window(app, SETTINGS_WINDOW) {
        Ok(window) => {
            std::thread::spawn(move || {
                std::thread::sleep(SHOW_ANYWAY_AFTER);
                if let Err(error) = show_if_hidden(&window) {
                    eprintln!("Could not show Settings: {error}");
                }
            });
        }
        Err(error) => eprintln!("Could not open Settings: {error}"),
    }
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
        // Its script for links would call the opener from the page, which is
        // not allowed to (capabilities/default.json); `navigation` handles
        // links instead.
        .plugin(
            tauri_plugin_opener::Builder::new()
                .open_js_links_on_click(false)
                .build(),
        )
        .manage(Shown::default())
        .manage(LastSize::default())
        .manage(OpenedProfiles::default())
        .menu(menu::build)
        .on_menu_event(|app, event| menu::handle(app, &event))
        .setup(|app| {
            let window = create_window(app.handle(), MAIN_WINDOW)?;
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
            if window.label() != MAIN_WINDOW {
                return;
            }
            match event {
                WindowEvent::Resized(size) => remember_size(window, *size),
                // The app quits with its window, which it only does once
                // Settings is closed too.
                WindowEvent::Destroyed => {
                    if let Some(settings) = window.app_handle().get_webview_window(SETTINGS_WINDOW)
                        && let Err(error) = settings.close()
                    {
                        eprintln!("Could not close Settings: {error}");
                    }
                }
                _ => {}
            }
        })
        .invoke_handler(tauri::generate_handler![
            page_ready,
            list_signing_identities,
            save_profile,
            take_opened_profile,
            dialog::ask,
            dialog::tell,
            menu::set_save_action,
            menu::set_appearance,
            menu::show_card_menu
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            // Also after closing the window, since the app then quits.
            RunEvent::Exit => save_last_size(app),
            // Finder's Open With, or files dropped on the Dock icon; also what
            // launched the app, if it was not running.
            #[cfg(target_os = "macos")]
            RunEvent::Opened { urls } => open_profiles(app.clone(), opened::file_paths(&urls)),
            _ => {}
        });
}
