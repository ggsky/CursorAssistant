mod card_api;
mod commands;
mod cursor;
mod device_id;
mod http_api;
mod icons;
mod machine_reset;
mod process_util;
mod splash;
mod state;
mod startup_trace;

use commands::*;
use state::AppState;
use tauri::menu::{Menu, MenuItem};
use tauri::tray::TrayIconEvent;
use tauri::Manager;
use tauri::image::Image;

pub fn run() {
    startup_trace::trace("app start");
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::load())
        .setup(|app| {
            startup_trace::trace("setup");
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(async move {
                splash::run_bootstrap(handle).await;
            });

            if let Some(tray) = app.tray_by_id("main") {
                let show = MenuItem::with_id(app, "show", "显示主窗口", true, None::<&str>)?;
                let quit = MenuItem::with_id(app, "quit", "退出", true, None::<&str>)?;
                let menu = Menu::with_items(app, &[&show, &quit])?;
                tray.set_menu(Some(menu))?;
                tray.on_menu_event(|app, event| match event.id.as_ref() {
                    "show" => {
                        if let Some(w) = app.get_webview_window("main") {
                            let _ = w.show();
                            let _ = w.set_focus();
                        }
                    }
                    "quit" => app.exit(0),
                    _ => {}
                });
                let _ = tray.on_tray_icon_event(|tray, event| {
                    if let TrayIconEvent::DoubleClick { .. } = event {
                        if let Some(app) = tray.app_handle().get_webview_window("main") {
                            let _ = app.show();
                            let _ = app.set_focus();
                        }
                    }
                });
            }

            let icon_path = app
                .path()
                .resource_dir()
                .ok()
                .map(|p| p.join("icons/icon.png"));
            if let Some(path) = icon_path {
                if let Ok(bytes) = std::fs::read(&path) {
                    if let Ok(img) = Image::from_bytes(&bytes) {
                        for label in ["main", "splash"] {
                            if let Some(w) = app.get_webview_window(label) {
                                let _ = w.set_icon(img.clone());
                            }
                        }
                    }
                }
            }
            let _ = icons::window_icon(app.handle());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_startup_state,
            get_license_status,
            activate_license,
            get_account_info,
            get_account_usage,
            switch_account,
            enable_software,
            disable_software,
            get_software_enable_status,
            get_auto_switch_enabled,
            set_auto_switch_enabled,
            reset_machine_code,
            get_current_permissions,
            get_latest_notice,
            get_consume_logs,
            get_cursor_path,
            save_cursor_path,
            find_cursor_path,
            get_app_info,
            get_cursor_version,
            reset_app,
            open_external,
            show_confirm_dialog,
            minimize_window,
            minimize_to_tray,
            request_quit
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
