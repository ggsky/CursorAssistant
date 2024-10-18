use crate::card_api;
use crate::cursor;
use crate::http_api;
use crate::machine_reset;
use crate::process_util;
use crate::state::AppState;
use serde::Deserialize;
use serde_json::Value;
use tauri::{AppHandle, State};

use self::bootstrap::{get_app_info as app_info, get_startup_state as startup_state, reset_app as do_reset_app};

pub mod bootstrap;

#[tauri::command]
pub fn get_startup_state(app: AppHandle, state: State<AppState>) -> Value {
    startup_state(&app, &state)
}

#[tauri::command]
pub fn get_license_status(state: State<AppState>) -> Value {
    card_api::get_license_status(&state)
}

#[derive(Deserialize)]
pub struct KeyArg {
    pub key: String,
}

#[tauri::command]
pub fn activate_license(state: State<AppState>, key: String) -> Value {
    let _ = key;
    card_api::activate_license(&state, key)
}

#[tauri::command]
pub fn get_account_info(state: State<AppState>) -> Value {
    cursor::get_account_info(&state)
}

#[tauri::command]
pub fn get_account_usage(state: State<AppState>) -> Value {
    cursor::get_account_usage(&state)
}

#[tauri::command]
pub fn switch_account(state: State<AppState>) -> Value {
    cursor::switch_account(&state)
}

#[tauri::command]
pub fn enable_software(state: State<AppState>) -> Value {
    cursor::enable_software(&state)
}

#[tauri::command]
pub fn disable_software(state: State<AppState>) -> Value {
    cursor::disable_software(&state)
}

#[tauri::command]
pub fn get_software_enable_status(state: State<AppState>) -> Value {
    cursor::get_software_enable_status(&state)
}

#[tauri::command]
pub fn get_auto_switch_enabled(state: State<AppState>) -> Value {
    cursor::get_auto_switch_enabled(&state)
}

#[derive(Deserialize)]
pub struct EnabledArg {
    pub enabled: bool,
}

#[tauri::command]
pub fn set_auto_switch_enabled(state: State<AppState>, enabled: bool) -> Value {
    cursor::set_auto_switch_enabled(&state, enabled)
}

#[tauri::command]
pub fn reset_machine_code() -> Value {
    machine_reset::reset_machine_code()
}

#[tauri::command]
pub fn get_current_permissions() -> Value {
    machine_reset::get_current_permissions()
}

#[tauri::command]
pub fn get_latest_notice() -> Value {
    http_api::get_latest_notice()
}

#[tauri::command]
pub fn get_consume_logs(state: State<AppState>) -> Value {
    card_api::get_consume_logs(&state)
}

#[tauri::command]
pub fn get_cursor_path(state: State<AppState>) -> Value {
    cursor::get_cursor_path(&state)
}

#[tauri::command]
pub fn save_cursor_path(state: State<AppState>, cursor_path: String) -> Value {
    cursor::save_cursor_path(&state, cursor_path)
}

#[tauri::command]
pub fn find_cursor_path() -> Value {
    cursor::find_cursor_path()
}

#[tauri::command]
pub fn get_app_info() -> Value {
    app_info()
}

#[tauri::command]
pub fn get_cursor_version(state: State<AppState>) -> Value {
    cursor::get_cursor_version(&state)
}

#[tauri::command]
pub fn reset_app(state: State<AppState>) -> Value {
    do_reset_app(&state)
}

#[derive(Deserialize)]
pub struct UrlArg {
    pub url: String,
}

#[tauri::command]
pub async fn open_external(app: AppHandle, url: String) -> Result<Value, String> {
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(url, None::<&str>)
        .map_err(|e| e.to_string())?;
    Ok(serde_json::json!({ "success": true }))
}

#[derive(Deserialize)]
pub struct MessageArg {
    pub message: String,
}

#[tauri::command]
pub async fn show_confirm_dialog(app: AppHandle, message: String) -> Result<bool, String> {
    use tauri_plugin_dialog::DialogExt;
    let confirmed = app
        .dialog()
        .message(&message)
        .title("确认")
        .kind(tauri_plugin_dialog::MessageDialogKind::Warning)
        .buttons(tauri_plugin_dialog::MessageDialogButtons::OkCancel)
        .blocking_show();
    Ok(confirmed)
}

#[tauri::command]
pub fn minimize_window(app: AppHandle) -> Result<(), String> {
    process_util::minimize_window(&app)
}

#[tauri::command]
pub fn minimize_to_tray(app: AppHandle) -> Result<(), String> {
    process_util::minimize_to_tray(&app)
}

#[tauri::command]
pub fn request_quit(app: AppHandle) {
    process_util::request_quit(&app);
}

// silence unused import warnings if serde structs are only for docs
#[allow(dead_code)]
fn _unused_structs(_: KeyArg, _: EnabledArg, _: UrlArg, _: MessageArg) {}
