//! Theme, motion and "Forget everything when quitting", kept here instead of
//! in the pages' storage, which a web view that keeps nothing starts without.

use std::fs;
use std::io;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::menu::Appearance;

pub const FILENAME: &str = "settings.json";

/// Must match `MOTION_EVENT` in src/ui/desktop.ts; a test checks both.
pub const MOTION_EVENT: &str = "motion-chosen";

/// The settings as saved, and whether this session's web views keep nothing.
pub struct Stored {
    settings: Mutex<AppSettings>,
    pub forgetting: bool,
}

impl Stored {
    pub fn load(app: &AppHandle) -> Self {
        let settings = path(app).map(|path| load(&path)).unwrap_or_default();
        Self {
            forgetting: settings.forget_on_quit,
            settings: Mutex::new(settings),
        }
    }

    pub fn get(&self) -> AppSettings {
        self.settings
            .lock()
            .map(|settings| *settings)
            .unwrap_or_default()
    }
}

fn path(app: &AppHandle) -> Option<PathBuf> {
    app.path()
        .app_config_dir()
        .ok()
        .map(|folder| folder.join(FILENAME))
}

/// Applies `change` and saves. True if anything changed.
pub fn update(app: &AppHandle, change: impl FnOnce(&mut AppSettings)) -> bool {
    let stored = app.state::<Stored>();
    let Ok(mut settings) = stored.settings.lock() else {
        return false;
    };
    let before = *settings;
    change(&mut settings);
    if *settings == before {
        return false;
    }
    if let Some(path) = path(app)
        && let Err(error) = save(&path, *settings)
    {
        eprintln!("Could not save the settings: {error}");
    }
    true
}

/// Folders where WebKit keeps the pages' storage and caches.
pub fn web_data_folders(app: &AppHandle) -> Vec<PathBuf> {
    let path = app.path();
    let mut folders: Vec<PathBuf> = path.app_cache_dir().into_iter().collect();
    #[cfg(target_os = "macos")]
    folders.extend(
        path.home_dir()
            .map(|home| home.join("Library/WebKit").join(&app.config().identifier)),
    );
    // WebKitGTK uses the app's data folder, which holds nothing else there.
    #[cfg(not(target_os = "macos"))]
    folders.extend(path.app_data_dir());
    folders
}

pub fn forget_web_data(app: &AppHandle) {
    for folder in web_data_folders(app) {
        remove(&folder);
    }
}

/// Records motion as the page chose or found it, and tells every window.
#[tauri::command]
pub fn set_motion(app: AppHandle, motion: Motion) {
    if update(&app, |settings| settings.motion = Some(motion))
        && let Err(error) = app.emit(MOTION_EVENT, motion)
    {
        eprintln!("Could not tell the pages about the motion: {error}");
    }
}

/// The page's `ForgetState` in src/desktop/bindings.ts.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
pub struct ForgetState {
    /// As saved, for the next start.
    stored: bool,
    /// This session's web views keep nothing.
    active: bool,
}

/// Whether "Forget everything when quitting" is on, saved and for this session.
#[tauri::command]
pub fn forget_on_quit(stored: State<'_, Stored>) -> ForgetState {
    ForgetState {
        stored: stored.get().forget_on_quit,
        active: stored.forgetting,
    }
}

/// Saves "Forget everything when quitting". It applies from the next start.
#[tauri::command]
pub fn set_forget_on_quit(app: AppHandle, forget: bool) {
    update(&app, |settings| settings.forget_on_quit = forget);
}

/// The page's `Motion` in src/ui/settings.ts.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Deserialize, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum Motion {
    System,
    Reduce,
    Full,
}

/// Theme and motion stay unknown until a page reports them, so the first
/// launch after an update keeps what the pages had stored. Cards are forgotten
/// unless the user turns that off.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppSettings {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub theme: Option<Appearance>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub motion: Option<Motion>,
    pub forget_on_quit: bool,
}

impl Default for AppSettings {
    fn default() -> Self {
        Self {
            theme: None,
            motion: None,
            forget_on_quit: true,
        }
    }
}

fn field<T: for<'de> Deserialize<'de>>(
    saved: &serde_json::Map<String, Value>,
    key: &str,
) -> Option<T> {
    serde_json::from_value(saved.get(key)?.clone()).ok()
}

impl AppSettings {
    /// Each field on its own: a bad value falls back to its default, and
    /// other keys are ignored.
    fn parse(text: &str) -> Self {
        let Ok(Value::Object(saved)) = serde_json::from_str(text) else {
            return Self::default();
        };
        Self {
            theme: field(&saved, "theme"),
            motion: field(&saved, "motion"),
            forget_on_quit: field(&saved, "forgetOnQuit").unwrap_or(true),
        }
    }

    /// Runs before each page's own scripts and, once per window, puts theme and
    /// motion where the pages read them. Later changes reach the pages as
    /// events. The keys must match THEME_KEY, SETTINGS_KEY and SEEDED_KEY in
    /// src/ui/storage.ts; a test checks them.
    pub fn init_script(self) -> String {
        let mut lines = Vec::new();
        match self.theme {
            Some(Appearance::System) => {
                lines.push(r#"localStorage.removeItem("dns-mobileconfig:theme");"#.to_owned());
            }
            Some(theme) => lines.push(format!(
                r#"localStorage.setItem("dns-mobileconfig:theme", {});"#,
                serde_json::to_string(&theme).unwrap_or_default()
            )),
            None => {}
        }
        if let Some(motion) = self.motion {
            let settings = serde_json::json!({ "motion": motion }).to_string();
            lines.push(format!(
                r#"localStorage.setItem("dns-mobileconfig:settings:v1", {});"#,
                serde_json::to_string(&settings).unwrap_or_default()
            ));
        }
        format!(
            r#"try {{ if (sessionStorage.getItem("dns-mobileconfig:seeded") === null) {{ {} sessionStorage.setItem("dns-mobileconfig:seeded", "1"); }} }} catch {{}}"#,
            lines.join(" ")
        )
    }
}

pub fn load(path: &Path) -> AppSettings {
    fs::read_to_string(path)
        .map(|text| AppSettings::parse(&text))
        .unwrap_or_default()
}

pub fn save(path: &Path, settings: AppSettings) -> io::Result<()> {
    if let Some(folder) = path.parent() {
        crate::private::create_dir(folder)?;
    }
    let temporary = path.with_extension("json.tmp");
    crate::private::write(
        &temporary,
        format!("{}\n", serde_json::to_string(&settings)?).as_bytes(),
    )?;
    fs::rename(&temporary, path)
}

/// Removes `folder` and everything in it. A missing one is fine.
pub fn remove(folder: &Path) {
    match fs::remove_dir_all(folder) {
        Ok(()) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => eprintln!("Could not remove {}: {error}", folder.display()),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reads_each_setting_on_its_own() {
        assert_eq!(
            AppSettings::parse(r#"{"theme":"dark","motion":"reduce","forgetOnQuit":true}"#),
            AppSettings {
                theme: Some(Appearance::Dark),
                motion: Some(Motion::Reduce),
                forget_on_quit: true,
            }
        );
        assert_eq!(
            AppSettings::parse(r#"{"theme":"sepia","motion":"full","forgetOnQuit":"no","x":1}"#),
            AppSettings {
                theme: None,
                motion: Some(Motion::Full),
                forget_on_quit: true,
            }
        );
        assert!(!AppSettings::parse(r#"{"forgetOnQuit":false}"#).forget_on_quit);
        for text in ["", "not json", "[]", "null"] {
            assert_eq!(AppSettings::parse(text), AppSettings::default(), "{text:?}");
        }
    }

    #[test]
    fn saves_what_it_reads_as_a_private_file() {
        let folder = tempfile::tempdir().unwrap();
        let path = folder.path().join("app").join(FILENAME);
        let settings = AppSettings {
            theme: Some(Appearance::Light),
            motion: None,
            forget_on_quit: true,
        };
        save(&path, settings).unwrap();
        assert_eq!(
            fs::read_to_string(&path).unwrap(),
            "{\"theme\":\"light\",\"forgetOnQuit\":true}\n"
        );
        assert_eq!(load(&path), settings);
        #[cfg(unix)]
        assert_eq!(crate::private::mode(&path), 0o600);
    }

    #[test]
    fn forgets_cards_unless_told_otherwise() {
        let folder = tempfile::tempdir().unwrap();
        assert_eq!(load(&folder.path().join(FILENAME)), AppSettings::default());
        assert!(AppSettings::default().forget_on_quit);
        assert!(AppSettings::parse("{}").forget_on_quit);
    }

    #[test]
    fn hands_the_pages_only_what_it_knows() {
        let wrap = |lines: &str| {
            format!(
                r#"try {{ if (sessionStorage.getItem("dns-mobileconfig:seeded") === null) {{ {lines} sessionStorage.setItem("dns-mobileconfig:seeded", "1"); }} }} catch {{}}"#
            )
        };
        assert_eq!(AppSettings::default().init_script(), wrap(""));
        let script = AppSettings {
            theme: Some(Appearance::Dark),
            motion: Some(Motion::Reduce),
            forget_on_quit: false,
        }
        .init_script();
        assert_eq!(
            script,
            wrap(
                r#"localStorage.setItem("dns-mobileconfig:theme", "dark"); localStorage.setItem("dns-mobileconfig:settings:v1", "{\"motion\":\"reduce\"}");"#
            )
        );
        let system = AppSettings {
            theme: Some(Appearance::System),
            ..AppSettings::default()
        };
        assert_eq!(
            system.init_script(),
            wrap(r#"localStorage.removeItem("dns-mobileconfig:theme");"#)
        );
    }

    #[test]
    fn removes_a_folder_with_everything_in_it() {
        let root = tempfile::tempdir().unwrap();
        let folder = root.path().join("WebKit");
        fs::create_dir_all(folder.join("LocalStorage")).unwrap();
        fs::write(folder.join("LocalStorage").join("cards"), "Home Wi-Fi").unwrap();
        remove(&folder);
        assert!(!folder.exists());
        remove(&folder);
    }
}
