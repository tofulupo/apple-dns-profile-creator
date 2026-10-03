use tauri::{AppHandle, Manager, WebviewWindow};
use tauri_plugin_dialog::{DialogExt, MessageDialogBuilder, MessageDialogButtons};

use crate::MAIN_WINDOW;

fn message(app: &AppHandle, message: &str) -> MessageDialogBuilder<tauri::Wry> {
    let (heading, details) = message.split_once("\n\n").unwrap_or((message, ""));
    app.dialog().message(details.trim()).title(heading.trim())
}

pub fn alert(window: &WebviewWindow, text: &str) -> MessageDialogBuilder<tauri::Wry> {
    message(window.app_handle(), text).parent(window)
}

pub fn app_alert(app: &AppHandle, text: &str) -> MessageDialogBuilder<tauri::Wry> {
    match app.get_webview_window(MAIN_WINDOW) {
        Some(window) => alert(&window, text),
        None => message(app, text),
    }
}

pub async fn show(dialog: MessageDialogBuilder<tauri::Wry>) -> Result<bool, String> {
    tauri::async_runtime::spawn_blocking(move || dialog.blocking_show())
        .await
        .map_err(|error| error.to_string())
}

/// `confirm()` for the page: whether the user chose OK.
#[tauri::command]
pub async fn ask(window: WebviewWindow, message: String) -> Result<bool, String> {
    show(alert(&window, &message).buttons(MessageDialogButtons::OkCancel)).await
}

/// `alert()` for the page: resolves once the user has dismissed it.
#[tauri::command]
pub async fn tell(window: WebviewWindow, message: String) -> Result<(), String> {
    show(alert(&window, &message).buttons(MessageDialogButtons::Ok))
        .await
        .map(drop)
}
