//! The menu bar: the standard macOS menus, plus Settings… (⌘,), File > Open
//! Profile… and Save,
//! View > Tool (⌘1), Profile (⌘2) and Appearance, a link to the source code in
//! Help, and the context menu of the profile page's cards.
//!
//! The page decides what Save does and which appearance is chosen, since it
//! owns the form, the list and the theme switch; it keeps the menu in step
//! through the commands here, and hears about choices through the events.

use serde::{Deserialize, Serialize};
use tauri::menu::{
    AboutMetadata, CheckMenuItem, CheckMenuItemBuilder, HELP_SUBMENU_ID, Menu, MenuBuilder,
    MenuEvent, MenuItem, MenuItemBuilder, SubmenuBuilder, WINDOW_SUBMENU_ID,
};
use tauri::{AppHandle, Emitter, Manager, Url, WebviewWindow, Wry};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;

use crate::MAIN_WINDOW;

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

const SETTINGS: &str = "settings";
const OPEN_PROFILE: &str = "open-profile";
const SAVE: &str = "save";

const SOURCE_CODE: &str = "source-code";
const CARD_EDIT: &str = "card-edit";
const CARD_DELETE: &str = "card-delete";

/// One of the app's pages, as View lists it.
struct Page {
    menu_id: &'static str,
    label: &'static str,
    /// The page's file in dist/.
    file: &'static str,
    /// Its address relative to the site root, as `pageHref` in
    /// scripts/build.ts links it.
    href: &'static str,
}

/// The same pages, labels and order as `PAGES` in pages/pages.ts; a test
/// checks both. The first is ⌘1, the next ⌘2.
const PAGES: [Page; 2] = [
    Page {
        menu_id: "page-tool",
        label: "Tool",
        file: "index.html",
        href: "./",
    },
    Page {
        menu_id: "page-profile",
        label: "Profile",
        file: "finalize.html",
        href: "finalize.html",
    },
];

fn page_by_menu_id(id: &str) -> Option<usize> {
    PAGES.iter().position(|page| page.menu_id == id)
}

/// Which of `PAGES` `url` shows, the start page also at the site root.
fn page_at(url: &Url) -> Option<usize> {
    let file = match url.path_segments()?.next_back()? {
        "" => "index.html",
        file => file,
    };
    PAGES.iter().position(|page| page.file == file)
}

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
    /// In the order of `PAGES`.
    pages: Vec<CheckMenuItem<Wry>>,
}

pub fn build(app: &AppHandle) -> tauri::Result<Menu<Wry>> {
    let info = app.package_info();
    let about = AboutMetadata {
        name: Some(info.name.clone()),
        version: Some(info.version.to_string()),
        // macOS shows the build number in brackets after the version, read from
        // CFBundleVersion when unset. It's the same number, so blank it.
        short_version: Some(String::new()),
        // Also names the licence, so no credits line repeating it.
        copyright: app.config().bundle.copyright.clone(),
        ..Default::default()
    };

    let settings = MenuItemBuilder::with_id(SETTINGS, "Settings…")
        .accelerator("CmdOrCtrl+,")
        .build(app)?;
    let app_menu = SubmenuBuilder::new(app, &info.name)
        .about(Some(about))
        .separator()
        .item(&settings)
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
    // Checked for the page shown, as each page loads (`show_page`).
    let pages = PAGES
        .iter()
        .enumerate()
        .map(|(index, page)| {
            CheckMenuItemBuilder::with_id(page.menu_id, page.label)
                .accelerator(format!("CmdOrCtrl+{}", index + 1))
                .checked(index == 0)
                .build(app)
        })
        .collect::<tauri::Result<Vec<_>>>()?;
    let mut view = SubmenuBuilder::new(app, "View");
    for item in &pages {
        view = view.item(item);
    }
    let view = view
        .separator()
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
        .text(SOURCE_CODE, format!("{} on GitHub", info.name))
        .build()?;

    app.manage(MenuItems {
        save,
        appearance,
        pages,
    });
    MenuBuilder::new(app)
        .items(&[&app_menu, &file, &edit, &view, &window, &help])
        .build()
}

pub fn handle(app: &AppHandle, event: &MenuEvent) {
    match event.id().as_ref() {
        SETTINGS => crate::open_settings(app),
        OPEN_PROFILE => choose_profiles(app),
        SAVE => emit(app, SAVE_EVENT, ()),

        SOURCE_CODE => open_url(app, REPOSITORY_URL),
        CARD_EDIT => emit(app, CARD_MENU_EVENT, "edit"),
        CARD_DELETE => emit(app, CARD_MENU_EVENT, "delete"),
        id => {
            if let Some(page) = page_by_menu_id(id) {
                go_to_page(app, page);
            } else if let Some(appearance) = Appearance::from_menu_id(id) {
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

/// Opens one of `PAGES` in the window, as its tab would.
fn go_to_page(app: &AppHandle, page: usize) {
    let Some(window) = app.get_webview_window(MAIN_WINDOW) else {
        return;
    };
    let Ok(current) = window.url() else {
        return;
    };
    // A check item also toggles itself when chosen; the current page's stays
    // checked, and another's until its page loads.
    if page_at(&current) == Some(page) {
        check_page(app, page);
        return;
    }
    let target = current.join(PAGES[page].href);
    if let Err(error) = target
        .map_err(|error| error.to_string())
        .and_then(|url| window.navigate(url).map_err(|error| error.to_string()))
    {
        eprintln!("Could not open {}: {error}", PAGES[page].label);
    }
}

/// Checks the page `url` shows in View, if it is one of `PAGES`. Called as
/// each of the app's pages loads, however it was reached.
pub fn show_page(app: &AppHandle, url: &Url) {
    if let Some(page) = page_at(url) {
        check_page(app, page);
    }
}

fn check_page(app: &AppHandle, page: usize) {
    // Not managed yet while the menu is still being built.
    let Some(items) = app.try_state::<MenuItems>() else {
        return;
    };
    for (index, item) in items.pages.iter().enumerate() {
        if let Err(error) = item.set_checked(index == page) {
            eprintln!("Could not check {}: {error}", PAGES[index].label);
        }
    }
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

    fn page(url: &str) -> Option<&'static str> {
        page_at(&Url::parse(url).unwrap()).map(|index| PAGES[index].label)
    }

    #[test]
    fn knows_each_page_by_its_address() {
        assert_eq!(page("tauri://localhost/"), Some("Tool"));
        assert_eq!(page("tauri://localhost/index.html"), Some("Tool"));
        assert_eq!(page("tauri://localhost/finalize.html"), Some("Profile"));
        assert_eq!(page("http://localhost:1430/finalize.html"), Some("Profile"));
        assert_eq!(page("tauri://localhost/finalize.html?x#y"), Some("Profile"));
        assert_eq!(page("tauri://localhost/other.html"), None);
    }

    #[test]
    fn links_each_page_from_the_others() {
        let profile = Url::parse("tauri://localhost/finalize.html").unwrap();
        for (index, item) in PAGES.iter().enumerate() {
            let url = profile.join(item.href).unwrap();
            assert_eq!(page_at(&url), Some(index), "{}", item.label);
        }
    }

    #[test]
    fn finds_each_page_by_its_menu_id_only() {
        for (index, item) in PAGES.iter().enumerate() {
            assert_eq!(page_by_menu_id(item.menu_id), Some(index));
        }
        assert_eq!(page_by_menu_id(SAVE), None);
        assert_eq!(page_by_menu_id("appearance-dark"), None);
    }

    #[test]
    fn follows_the_system_unless_forced() {
        assert_eq!(Appearance::System.theme(), None);
        assert_eq!(Appearance::Light.theme(), Some(tauri::Theme::Light));
        assert_eq!(Appearance::Dark.theme(), Some(tauri::Theme::Dark));
    }
}
