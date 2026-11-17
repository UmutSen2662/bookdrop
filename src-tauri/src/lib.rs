mod host;
mod opds;

use std::path::Path;
use tauri::Manager;
use tauri_plugin_window_state::{StateFlags, WindowExt};

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
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_sql::Builder::default().build())
        .setup(|app| {
            // A development override moves covers outside the static asset
            // scope in tauri.conf.json.
            if let Ok(home) = std::env::var("BOOKDROP_HOME") {
                let scope = app.asset_protocol_scope();
                let _ = scope.allow_directory(Path::new(&home).join("covers"), true);
                let _ = scope.allow_directory(Path::new(&home).join("candidates"), true);
            }

            // The window starts hidden (tauri.conf.json). Restore its saved
            // position before showing it so it never appears at the OS default.
            let window = app
                .get_webview_window("main")
                .ok_or("main window not found")?;
            window.restore_state(StateFlags::all())?;
            window.show()?;
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
            host::open_path,
            opds::start_sharing,
            opds::stop_sharing,
            opds::set_share_books,
            opds::share_status
        ])
        // Restored by hand in setup, before the window is shown.
        .plugin(
            tauri_plugin_window_state::Builder::default()
                .skip_initial_state("main")
                .build(),
        )
        .manage(opds::OpdsState::default())
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app, event| {
            // Closing the window ends the process, so this mostly lets an
            // in-flight download finish.
            if matches!(event, tauri::RunEvent::Exit) {
                opds::shutdown(app);
            }
        });
}
