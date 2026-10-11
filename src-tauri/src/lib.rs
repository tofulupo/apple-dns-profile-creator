mod app_settings;
mod dialog;
mod menu;
mod navigation;
mod opened;
mod private;
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
        tighten_folders(window.app_handle());
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

/// Saves the profile to ~/Downloads, signed with `sign_with` if given, and
/// returns the file name it was saved under, numbered if the name was taken.
#[tauri::command]
async fn save_profile(
    window: WebviewWindow,
    filename: String,
    xml: String,
    sign_with: Option<String>,
) -> Result<String, String> {
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
    Ok(name)
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

/// The text of a signed profile dropped on the page, after the same signature
/// check as an opened one. `None` when the user doesn't open it after all.
#[tauri::command]
async fn open_dropped_profile(
    app: AppHandle,
    name: String,
    bytes: Vec<u8>,
) -> Result<Option<String>, String> {
    blocking(move || {
        let read = opened::read_dropped(name, bytes)?;
        if read.broken_signature && !open_anyway(&app, &read.profile.name) {
            return Ok(None);
        }
        Ok(Some(read.profile.text))
    })
    .await
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
        &format!("“{name}”\n\n Broken signature. Profile may have been altered since signing\n"),
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
    let stored = app.state::<app_settings::Stored>();
    Ok(WebviewWindowBuilder::from_config(app, config)?
        .incognito(stored.forgetting)
        .initialization_script(stored.get().init_script())
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

/// Where the app and its web view keep files: the window size, shared
/// profiles, and the pages' storage with the cards.
fn app_folders(app: &AppHandle) -> Vec<PathBuf> {
    let path = app.path();
    let folders = [
        path.app_config_dir(),
        path.app_cache_dir(),
        path.app_data_dir(),
    ]
    .into_iter()
    .filter_map(Result::ok);
    #[cfg(target_os = "macos")]
    let folders = folders.chain(
        path.home_dir()
            .map(|home| home.join("Library/WebKit").join(&app.config().identifier)),
    );
    folders.collect()
}

fn tighten_folders(app: &AppHandle) {
    for folder in app_folders(app) {
        if let Err(error) = private::tighten(&folder) {
            eprintln!("Could not make {} private: {error}", folder.display());
        }
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
            let stored = app_settings::Stored::load(app.handle());
            if stored.forgetting {
                app_settings::forget_web_data(app.handle());
            }
            app.manage(stored);
            clean_up_shares(app.handle());
            tighten_folders(app.handle());
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
            open_dropped_profile,
            app_settings::set_motion,
            app_settings::forget_on_quit,
            app_settings::set_forget_on_quit,
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
                if app
                    .try_state::<app_settings::Stored>()
                    .is_some_and(|stored| stored.get().forget_on_quit)
                {
                    app_settings::forget_web_data(app);
                }
            }

            #[cfg(target_os = "macos")]
            RunEvent::Opened { urls } => open_profiles(app.clone(), opened::file_paths(&urls)),
            _ => {}
        });
}
