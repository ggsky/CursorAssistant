use crate::card_api;
use crate::cursor;
use crate::device_id::local_device_id;
use crate::state::{current_email, license_is_active, AppState};
use crate::startup_trace::trace;
use serde_json::{json, Value};
use tauri::{AppHandle, Manager};

const APP_NAME: &str = "Cursor助手";
const APP_VERSION: &str = env!("CARGO_PKG_VERSION");

pub fn get_app_info() -> Value {
    json!({
        "success": true,
        "name": APP_NAME,
        "version": APP_VERSION,
        "versionLabel": format!("v {APP_VERSION}")
    })
}

pub fn get_startup_state(app: &AppHandle, state: &AppState) -> Value {
    trace("get_startup_state");
    let _ = local_device_id(state);
    let cursor_version = cursor::get_cursor_version(state)
        .get("version")
        .and_then(|v| v.as_str())
        .unwrap_or("")
        .to_string();
    let license = card_api::get_license_status(state);
    let activated = state.with(license_is_active);
    let (cursor_path, software, auto_switch, email) = state.with(|cfg| {
        (
            cfg.cursor_path.clone().unwrap_or_default(),
            cfg.software_enabled,
            cfg.auto_switch_enabled,
            current_email(cfg),
        )
    });
    let needs_path = cursor_path.is_empty();
    json!({
        "success": true,
        "appInfo": get_app_info(),
        "cursorPath": cursor_path,
        "cursorVersion": cursor_version,
        "license": license,
        "account": { "success": activated, "email": if activated { email } else { String::new() } },
        "softwareEnable": {
            "success": true,
            "enabled": activated && software && !needs_path,
            "needsCursorPath": needs_path
        },
        "autoSwitch": { "success": true, "enabled": auto_switch && activated },
        "seamlessStartup": {
            "reset": false,
            "needsCursorPath": activated && needs_path,
            "reason": if activated && needs_path { "未找到 Cursor 安装目录，请手动填写并保存。" } else { "" }
        },
        "updateInfo": {
            "hasUpdate": false,
            "newVersion": "",
            "downloadUrl": ""
        },
        "windowLabel": app.get_webview_window("main").map(|w| w.label().to_string())
    })
}

pub fn reset_app(state: &AppState) -> Value {
    state.with_mut(|cfg| {
        let device = cfg.device_id.clone();
        *cfg = crate::state::AppConfig {
            device_id: device,
            ..Default::default()
        };
    });
    json!({ "success": true })
}
