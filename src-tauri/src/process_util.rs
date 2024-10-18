use tauri::{AppHandle, Manager};

pub fn request_quit(app: &AppHandle) {
    app.exit(0);
}

pub fn minimize_window(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.minimize().map_err(|e| e.to_string())?;
    }
    Ok(())
}

pub fn minimize_to_tray(app: &AppHandle) -> Result<(), String> {
    if let Some(win) = app.get_webview_window("main") {
        win.hide().map_err(|e| e.to_string())?;
    }
    Ok(())
}
