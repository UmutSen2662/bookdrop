mod host;

use std::path::Path;
use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        // Must be registered before the other plugins. A second launch focuses
        // the existing window instead of opening another writer on the same
        // library and database.
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            // A development override moves covers outside the static asset
            // scope in tauri.conf.json.
            if let Ok(home) = std::env::var("BOOKDROP_HOME") {
                let scope = app.asset_protocol_scope();
                let _ = scope.allow_directory(Path::new(&home).join("covers"), true);
                let _ = scope.allow_directory(Path::new(&home).join("candidates"), true);
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            host::read_file,
            host::write_file_atomic,
            host::copy_file,
            host::rename_file,
            host::remove_file,
            host::ensure_dir,
            host::remove_dir,
            host::list_dir,
            host::stat_path,
            host::hash_file,
            host::run_process,
            host::http_get,
            host::make_thumbnail,
            host::image_size,
            host::env_var,
            host::open_path
        ])
        .plugin(tauri_plugin_window_state::Builder::default().build())
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
