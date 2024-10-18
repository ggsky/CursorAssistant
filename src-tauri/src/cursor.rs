use crate::state::{
    current_email, license_is_active, path_looks_like_cursor_install, read_cursor_version,
    AppState, ConsumeLog, DEMO_ACCOUNTS,
};
use crate::startup_trace::trace;
use serde_json::{json, Value};
use std::path::{Path, PathBuf};

pub fn get_cursor_path(state: &AppState) -> Value {
    state.with(|cfg| {
        json!({
            "success": true,
            "cursorPath": cfg.cursor_path.clone().unwrap_or_default()
        })
    })
}

pub fn save_cursor_path(state: &AppState, cursor_path: String) -> Value {
    let trimmed = cursor_path.trim().to_string();
    if trimmed.is_empty() {
        return json!({ "success": false, "error": "请输入安装目录路径" });
    }
    let path = PathBuf::from(&trimmed);
    if !path_looks_like_cursor_install(&path) {
        return json!({
            "success": false,
            "error": "该路径不像 Cursor 安装目录（未找到 Cursor.exe / cursor / package.json）"
        });
    }
    state.with_mut(|cfg| {
        cfg.cursor_path = Some(trimmed.clone());
        if license_is_active(cfg) {
            cfg.software_enabled = true;
        }
    });
    json!({ "success": true, "cursorPath": trimmed })
}

pub fn find_cursor_path() -> Value {
    trace("scan cursor install path");
    if let Some(found) = scan_cursor_install() {
        json!({ "success": true, "cursorPath": found.to_string_lossy() })
    } else {
        json!({ "success": false, "error": "未自动找到 Cursor 安装目录", "cursorPath": "" })
    }
}

pub fn get_cursor_version(state: &AppState) -> Value {
    let path = state.with(|cfg| cfg.cursor_path.clone());
    match path.as_deref() {
        Some(p) if !p.is_empty() => {
            if let Some(version) = read_cursor_version(Path::new(p)) {
                json!({ "success": true, "version": version })
            } else {
                json!({ "success": true, "version": "" })
            }
        }
        _ => json!({ "success": true, "version": "" }),
    }
}

pub fn get_account_info(state: &AppState) -> Value {
    if !state.with(license_is_active) {
        return json!({ "success": false, "error": "请先激活", "licenseInvalid": true });
    }
    state.with(|cfg| json!({ "success": true, "email": current_email(cfg) }))
}

pub fn get_account_usage(state: &AppState) -> Value {
    if !state.with(license_is_active) {
        return json!({ "success": false, "error": "请先激活", "licenseInvalid": true });
    }
    json!({
        "success": true,
        "percentUsed": 8.0,
        "membership": "demo",
        "remaining": 920,
        "used": 80,
        "total": 1000,
        "exhausted": false,
        "reason": "demo"
    })
}

pub fn switch_account(state: &AppState) -> Value {
    if !state.with(license_is_active) {
        return json!({ "success": false, "error": "请先激活", "licenseInvalid": true });
    }
    let email = state.with_mut(|cfg| {
        cfg.demo_account_index = (cfg.demo_account_index + 1) % DEMO_ACCOUNTS.len();
        let email = current_email(cfg);
        cfg.consume_logs.insert(
            0,
            ConsumeLog {
                consume_time: crate::state::now_iso(),
                account: email.clone(),
                client_ip: "127.0.0.1".into(),
            },
        );
        if cfg.consume_logs.len() > 50 {
            cfg.consume_logs.truncate(50);
        }
        email
    });
    json!({
        "success": true,
        "message": "已切换本地演示账号（不会写入 Cursor 会话）",
        "account": { "email": email },
        "waitTime": 5
    })
}

pub fn enable_software(state: &AppState) -> Value {
    software_toggle(state, true)
}

pub fn disable_software(state: &AppState) -> Value {
    software_toggle(state, false)
}

fn software_toggle(state: &AppState, enabled: bool) -> Value {
    if !state.with(license_is_active) {
        return json!({ "success": false, "error": "请先激活", "licenseInvalid": true });
    }
    let needs_path = state.with(|cfg| cfg.cursor_path.as_deref().unwrap_or("").is_empty());
    if enabled && needs_path {
        return json!({
            "success": false,
            "enabled": false,
            "needsCursorPath": true,
            "error": "请先设置 Cursor 安装目录"
        });
    }
    state.with_mut(|cfg| cfg.software_enabled = enabled && !needs_path);
    json!({
        "success": true,
        "enabled": enabled && !needs_path,
        "needsCursorPath": needs_path
    })
}

pub fn get_software_enable_status(state: &AppState) -> Value {
    if !state.with(license_is_active) {
        return json!({ "success": false, "error": "请先激活", "licenseInvalid": true });
    }
    state.with(|cfg| {
        let needs = cfg.cursor_path.as_deref().unwrap_or("").is_empty();
        json!({
            "success": true,
            "enabled": cfg.software_enabled && !needs,
            "needsCursorPath": needs
        })
    })
}

pub fn get_auto_switch_enabled(state: &AppState) -> Value {
    state.with(|cfg| json!({ "success": true, "enabled": cfg.auto_switch_enabled }))
}

pub fn set_auto_switch_enabled(state: &AppState, enabled: bool) -> Value {
    if !state.with(license_is_active) {
        return json!({ "success": false, "error": "请先激活", "licenseInvalid": true });
    }
    state.with_mut(|cfg| cfg.auto_switch_enabled = enabled);
    json!({ "success": true, "enabled": enabled })
}

fn scan_cursor_install() -> Option<PathBuf> {
    let mut candidates: Vec<PathBuf> = Vec::new();
    if let Ok(home) = std::env::var("HOME") {
        let home = PathBuf::from(home);
        candidates.push(home.join(".local/share/cursor"));
        candidates.push(home.join("Applications/Cursor.app"));
        candidates.push(home.join(".cursor"));
    }
    candidates.push(PathBuf::from("/opt/Cursor"));
    candidates.push(PathBuf::from("/opt/cursor"));
    candidates.push(PathBuf::from("/usr/share/cursor"));
    candidates.push(PathBuf::from("/usr/lib/cursor"));
    candidates.push(PathBuf::from("/Applications/Cursor.app"));
    if let Ok(local) = std::env::var("LOCALAPPDATA") {
        candidates.push(PathBuf::from(local).join("Programs").join("cursor"));
    }
    if let Ok(pf) = std::env::var("ProgramFiles") {
        candidates.push(PathBuf::from(pf).join("cursor"));
    }
    if let Some(exe) = which_cursor() {
        if let Some(dir) = exe.parent() {
            candidates.push(dir.to_path_buf());
            if let Some(up) = dir.parent() {
                candidates.push(up.to_path_buf());
            }
        }
    }
    candidates.into_iter().find(|p| path_looks_like_cursor_install(p))
}

fn which_cursor() -> Option<PathBuf> {
    let Ok(paths) = std::env::var("PATH") else {
        return None;
    };
    for dir in std::env::split_paths(&paths) {
        for name in ["cursor", "Cursor", "cursor.exe"] {
            let p = dir.join(name);
            if p.is_file() {
                return Some(p);
            }
        }
    }
    None
}
