/// The commands in src-tauri/src/ the page may call. Declaring them makes each
/// one need a permission (`allow-<command>`), which capabilities/default.json
/// grants; without this, every command would be open to any page.
const COMMANDS: &[&str] = &[
    "page_ready",
    "list_signing_identities",
    "save_profile",
    "take_opened_profile",
    "ask",
    "tell",
    "set_save_action",
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
