mod dialog;
mod menu;
mod navigation;
mod opened;
mod profile;
mod save;
mod share;
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
use tauri_plugin_dialog::{MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

use crate::dialog::{alert, show};
use crate::opened::{OPENED_EVENT, OpenedProfile, OpenedProfiles};
use crate::signing::SigningIdentity;
use crate::window_size::WindowSize;

/// Defined in tauri.conf.json.
pub(crate) const MAIN_WINDOW: &str = "main";
/// Defined in tauri.conf.json.
pub(crate) const SETTINGS_WINDOW: &str = "settings";

/// Shows a window anyway if its page fails before calling `page_ready`.
const SHOW_ANYWAY_AFTER: Duration = Duration::from_secs(3);

#[derive(Default)]
struct Shown(AtomicBool);

#[derive(Default)]
struct LastSize(Mutex<Option<WindowSize>>);

fn show_once(window: &WebviewWindow) -> tauri::Result<()> {
    if window.state::<Shown>().0.swap(true, Ordering::SeqCst) {
        return Ok(());
    }
    window.show()?;
    window.set_focus()
}

/// Called by each page once its styles apply, with its background colour.
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

fn show_if_hidden(window: &WebviewWindow) -> tauri::Result<()> {
    if window.is_visible()? {
        return Ok(());
    }
    window.show()?;
    window.set_focus()
}

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

/// Saves the profile to ~/Downloads, signed with `sign_with` if given.
#[tauri::command]
async fn save_profile(
    window: WebviewWindow,
    filename: String,
    xml: String,
    sign_with: Option<String>,
) -> Result<(), String> {
    profile::check(&xml)?;
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

/// Opens the share menu for the profile below `anchor`, signed with `sign_with` if given.
#[tauri::command]
async fn share_profile(
    window: WebviewWindow,
    filename: String,
    xml: String,
    sign_with: Option<String>,
    anchor: share::Anchor,
) -> Result<(), String> {
    profile::check(&xml)?;
    let contents = match sign_with {
        Some(id) => {
            blocking(move || signing::keychain().sign(&xml, &id))
                .await?
                .signed
        }
        None => xml.into_bytes(),
    };
    let folder = share::folder(window.app_handle())?;
    let path = blocking(move || {
        share::write(&folder, &filename, &contents).map_err(|error| error.to_string())
    })
    .await?;
    share::show(&window, path, anchor)
}

/// The oldest profile opened with the app that the page has not taken yet.
#[tauri::command]
fn take_opened_profile(opened: State<'_, OpenedProfiles>) -> Option<OpenedProfile> {
    opened.take()
}

pub(crate) fn open_profiles(app: AppHandle, paths: Vec<PathBuf>) {
    if paths.is_empty() {
        return;
    }
    std::thread::spawn(move || {
        let mut failures = Vec::new();
        let mut queued = false;
        for path in &paths {
            match opened::read_profile(path) {
                Ok(read) if read.broken_signature && !open_anyway(&app, &read.profile.name) => {}
                Ok(read) => {
                    app.state::<OpenedProfiles>().push(read.profile);
                    queued = true;
                }
                Err(message) => failures.push(message),
            }
        }
        if queued {
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

fn open_anyway(app: &AppHandle, name: &str) -> bool {
    bring_to_front(app);
    dialog::app_alert(
        app,
        &format!(
            "“{name}” has a broken signature.\n\nIt was changed after it was signed, or the \
             signature is damaged. Open it anyway?"
        ),
    )
    .kind(MessageDialogKind::Warning)
    .buttons(MessageDialogButtons::OkCancelCustom(
        "Open Anyway".into(),
        "Cancel".into(),
    ))
    .blocking_show()
}

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

fn clean_up_shares(app: &AppHandle) {
    match share::folder(app) {
        Ok(folder) => share::clean_up(&folder),
        Err(error) => eprintln!("Could not find the shared files: {error}"),
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
        // The page has no opener permission (capabilities/default.json).
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
            clean_up_shares(app.handle());
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
            share_profile,
            take_opened_profile,
            dialog::ask,
            dialog::tell,
            menu::set_save_action,
            menu::set_share_enabled,
            menu::set_appearance,
            menu::show_card_menu
        ])
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| match event {
            RunEvent::Exit => {
                save_last_size(app);
                clean_up_shares(app);
            }

            #[cfg(target_os = "macos")]
            RunEvent::Opened { urls } => open_profiles(app.clone(), opened::file_paths(&urls)),
            _ => {}
        });
}
