/// Each needs its `allow-<command>` permission granted in capabilities/default.json.
const COMMANDS: &[&str] = &[
    "page_ready",
    "list_signing_identities",
    "save_profile",
    "share_profile",
    "take_opened_profile",
    "open_dropped_profile",
    "set_motion",
    "forget_on_quit",
    "set_forget_on_quit",
    "ask",
    "tell",
    "set_save_action",
    "set_share_enabled",
    "set_appearance",
    "show_card_menu",
];

fn main() {
    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to run the Tauri build script");
}
