//! Native alerts for the page and for the commands.
//!
//! WKWebView only shows `alert()` and `confirm()` when the app implements
//! them, which wry does not: `confirm()` returns false at once and `alert()`
//! does nothing. The page calls these instead (src/ui/dialogs.ts).

use tauri::WebviewWindow;
use tauri_plugin_dialog::{DialogExt, MessageDialogBuilder, MessageDialogButtons};

/// An alert attached to `window` as a sheet.
///
/// The first paragraph becomes the alert's bold heading and the rest its
/// smaller text below, the way macOS alerts are laid out.
pub fn alert(window: &WebviewWindow, message: &str) -> MessageDialogBuilder<tauri::Wry> {
    let (heading, details) = message.split_once("\n\n").unwrap_or((message, ""));
    window
        .dialog()
        .message(details.trim())
        .title(heading.trim())
        .parent(window)
}

/// Shows `dialog` and resolves with whether the user chose the OK button.
/// Runs off the async runtime's threads, which it would block while the user
/// decides.
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
