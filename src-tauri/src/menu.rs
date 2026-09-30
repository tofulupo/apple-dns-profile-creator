//! The menu bar: the standard macOS menus, plus File > Open Profile… and Save,
//! View > Appearance, links to the website and the source code in Help, and
//! the context menu of the profile page's cards.
//!
//! The page decides what Save does and which appearance is chosen, since it
//! owns the form, the list and the theme switch; it keeps the menu in step
//! through the commands here, and hears about choices through the events.

use serde::{Deserialize, Serialize};
use tauri::menu::{
    AboutMetadata, CheckMenuItem, CheckMenuItemBuilder, HELP_SUBMENU_ID, Menu, MenuBuilder,
    MenuEvent, MenuItem, MenuItemBuilder, SubmenuBuilder, WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Emitter, Manager, WebviewWindow, Wry};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::MAIN_WINDOW;

/// The same as `SITE_URL` in pages/pages.ts.
const SITE_URL: &str = "https://apple.mobileconfig.deno.net/";
/// The same as `REPOSITORY_URL` in scripts/build.ts.
const REPOSITORY_URL: &str = "https://github.com/tofulupo/apple-dns-profile-creator";

/// Emitted when File > Save (⌘S) is chosen. Must match `SAVE_EVENT` in
/// src/ui/desktop.ts; a test checks both.
pub const SAVE_EVENT: &str = "save-requested";
/// Emitted with the chosen `Appearance`. Must match `APPEARANCE_EVENT` in
/// src/ui/desktop.ts; a test checks both.
pub const APPEARANCE_EVENT: &str = "appearance-chosen";
/// Emitted with `"edit"` or `"delete"` when a card's context menu item is
/// chosen. Must match `CARD_MENU_EVENT` in src/ui/desktop.ts; a test checks
/// both.
pub const CARD_MENU_EVENT: &str = "card-menu-chosen";

const OPEN_PROFILE: &str = "open-profile";
const SAVE: &str = "save";
const WEBSITE: &str = "website";
const SOURCE_CODE: &str = "source-code";
const CARD_EDIT: &str = "card-edit";
const CARD_DELETE: &str = "card-delete";

/// The page's theme switch, as View > Appearance offers it.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Appearance {
    System,
    Light,
    Dark,
}

impl Appearance {
    const ALL: [Self; 3] = [Self::System, Self::Light, Self::Dark];

    fn menu_id(self) -> &'static str {
        match self {
            Self::System => "appearance-system",
            Self::Light => "appearance-light",
            Self::Dark => "appearance-dark",
        }
    }

    fn label(self) -> &'static str {
        match self {
            Self::System => "System",
            Self::Light => "Light",
            Self::Dark => "Dark",
        }
    }

    fn from_menu_id(id: &str) -> Option<Self> {
        Self::ALL
            .into_iter()
            .find(|appearance| appearance.menu_id() == id)
    }

    /// The app's appearance: what the title bar, menus, dialogs and the
    /// webview's `prefers-color-scheme` follow. None follows the system.
    fn theme(self) -> Option<tauri::Theme> {
        match self {
            Self::System => None,
            Self::Light => Some(tauri::Theme::Light),
            Self::Dark => Some(tauri::Theme::Dark),
        }
    }
}

/// The menu items the page changes, kept to update them.
struct MenuItems {
    save: MenuItem<Wry>,
    appearance: Vec<(Appearance, CheckMenuItem<Wry>)>,
}

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let info = app.package_info();
    let about = AboutMetadata {
        name: Some(info.name.clone()),
        version: Some(info.version.to_string()),
        copyright: app.config().bundle.copyright.clone(),
        credits: Some("Open source under the BSD 3-Clause License.".into()),
        ..Default::default()
    };

    let app_menu = SubmenuBuilder::new(app, &info.name)
        .about(Some(about))
        .separator()
        .services()
        .separator()
        .hide()
        .hide_others()
        .show_all()
        .separator()
        .quit()
        .build()?;
    let open = MenuItemBuilder::with_id(OPEN_PROFILE, "Open Profile…")
        .accelerator("CmdOrCtrl+O")
        .build(app)?;
    // Named and enabled by each page (`set_save_action`), for what its main
    // button does.
    let save = MenuItemBuilder::with_id(SAVE, "Save Profile")
        .accelerator("CmdOrCtrl+S")
        .enabled(false)
        .build(app)?;
    let file = SubmenuBuilder::new(app, "File")
        .item(&open)
        .item(&save)
        .separator()
        .close_window()
        .build()?;
    // Without these, copy and paste would not work in the page's fields.
    // Named "Edit", macOS adds AutoFill, Dictation and Emoji & Symbols itself.
    let edit = SubmenuBuilder::new(app, "Edit")
        .undo()
        .redo()
        .separator()
        .cut()
        .copy()
        .paste()
        .select_all()
        .build()?;
    // Checked by the page on load (`set_appearance`), which knows the choice.
    let appearance = Appearance::ALL
        .into_iter()
        .map(|appearance| {
            CheckMenuItemBuilder::with_id(appearance.menu_id(), appearance.label())
                .checked(appearance == Appearance::System)
                .build(app)
                .map(|item| (appearance, item))
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let mut appearance_menu = SubmenuBuilder::new(app, "Appearance");
    for (_, item) in &appearance {
        appearance_menu = appearance_menu.item(item);
    }
    let view = SubmenuBuilder::new(app, "View")
        .item(&appearance_menu.build()?)
        .separator()
        .fullscreen()
        .build()?;
    // The ids make macOS treat these as the Window and Help menus: the window
    // list, and the search field.
    let window = SubmenuBuilder::with_id(app, WINDOW_SUBMENU_ID, "Window")
        .minimize()
        .maximize()
        .separator()
        .bring_all_to_front()
        .build()?;
    let help = SubmenuBuilder::with_id(app, HELP_SUBMENU_ID, "Help")
        .text(WEBSITE, format!("{} Website", info.name))
        .text(SOURCE_CODE, "Source Code on GitHub")
        .build()?;

    app.manage(MenuItems { save, appearance });
    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &window, &help])
        .build()
}

pub fn handle(app: &AppHandle, event: &MenuEvent) {
    match event.id().as_ref() {
        OPEN_PROFILE => choose_profiles(app),
        SAVE => emit(app, SAVE_EVENT, ()),
        WEBSITE => open_url(app, SITE_URL),
        SOURCE_CODE => open_url(app, REPOSITORY_URL),
        CARD_EDIT => emit(app, CARD_MENU_EVENT, "edit"),
        CARD_DELETE => emit(app, CARD_MENU_EVENT, "delete"),
        id => {
            if let Some(appearance) = Appearance::from_menu_id(id) {
                // Applied here too, so the check marks are right even if the
                // page does not answer; it confirms with `set_appearance`.
                apply_appearance(app, appearance);
                emit(app, APPEARANCE_EVENT, appearance);
            }
        }
    }
}

fn emit<S: Serialize + Clone>(app: &AppHandle, event: &str, payload: S) {
    if let Err(error) = app.emit(event, payload) {
        eprintln!("Could not tell the page about {event}: {error}");
    }
}

/// Checks `appearance` alone (a check item also toggles itself when chosen)
/// and gives it to the app's title bar, menus and dialogs.
fn apply_appearance(app: &AppHandle, appearance: Appearance) {
    let items = app.state::<MenuItems>();
    for (each, item) in &items.appearance {
        if let Err(error) = item.set_checked(*each == appearance) {
            eprintln!("Could not check {:?}: {error}", each.label());
        }
    }
    app.set_theme(appearance.theme());
}

/// Renames File > Save for what the page's main button does, and enables it
/// while that button can be used.
#[tauri::command]
pub async fn set_save_action(app: AppHandle, label: String, enabled: bool) -> Result<(), String> {
    let items = app.state::<MenuItems>();
    items
        .save
        .set_text(label)
        .and_then(|()| items.save.set_enabled(enabled))
        .map_err(|error| error.to_string())
}

/// The theme switch's choice, for the menu and the app's appearance.
#[tauri::command]
pub async fn set_appearance(app: AppHandle, appearance: Appearance) {
    apply_appearance(&app, appearance);
}

/// A profile card's context menu at the pointer: its Edit (or Fix) and Delete
/// buttons. The choice arrives as `CARD_MENU_EVENT`.
#[tauri::command]
pub async fn show_card_menu(window: WebviewWindow, fix: bool) -> Result<(), String> {
    let menu = MenuBuilder::new(&window)
        .text(CARD_EDIT, if fix { "Fix" } else { "Edit" })
        .separator()
        .text(CARD_DELETE, "Delete")
        .build()
        .map_err(|error| error.to_string())?;
    // Waits on the main thread, which runs the menu until it closes.
    tauri::async_runtime::spawn_blocking(move || window.popup_menu(&menu))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

/// The system's Open panel, limited to profiles; the chosen files are opened
/// as if from Finder.
fn choose_profiles(app: &AppHandle) {
    let mut dialog = app
        .dialog()
        .file()
        .set_title("Open Profile")
        .add_filter("Configuration Profile", &["mobileconfig"]);
    if let Some(window) = app.get_webview_window(MAIN_WINDOW) {
        dialog = dialog.set_parent(&window);
    }
    let app = app.clone();
    dialog.pick_files(move |files| {
        let paths = files
            .unwrap_or_default()
            .into_iter()
            .filter_map(|file| file.into_path().ok())
            .collect();
        crate::open_profiles(app, paths);
    });
}

/// Opens `url` in the default browser, or whichever app handles its scheme.
pub fn open_url(app: &AppHandle, url: &str) {
    if let Err(error) = app.opener().open_url(url, None::<&str>) {
        eprintln!("Could not open {url}: {error}");
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn appearances_cross_as_the_page_names_them() {
        for (appearance, name) in [
            (Appearance::System, "system"),
            (Appearance::Light, "light"),
            (Appearance::Dark, "dark"),
        ] {
            let json = serde_json::to_string(&appearance).unwrap();
            assert_eq!(json, format!("\"{name}\""));
            assert_eq!(
                serde_json::from_str::<Appearance>(&json).unwrap(),
                appearance
            );
        }
        assert!(serde_json::from_str::<Appearance>("\"sepia\"").is_err());
    }

    #[test]
    fn finds_each_appearance_by_its_menu_id_only() {
        for appearance in Appearance::ALL {
            assert_eq!(
                Appearance::from_menu_id(appearance.menu_id()),
                Some(appearance)
            );
        }
        assert_eq!(Appearance::from_menu_id(SAVE), None);
    }

    #[test]
    fn follows_the_system_unless_forced() {
        assert_eq!(Appearance::System.theme(), None);
        assert_eq!(Appearance::Light.theme(), Some(tauri::Theme::Light));
        assert_eq!(Appearance::Dark.theme(), Some(tauri::Theme::Dark));
    }
}
