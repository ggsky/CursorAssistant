use chrono::{Duration, Local};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Mutex;

const CONFIG_FILE: &str = "learning-config.json";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ConsumeLog {
    #[serde(rename = "consumeTime")]
    pub consume_time: String,
    pub account: String,
    #[serde(rename = "clientIp")]
    pub client_ip: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AppConfig {
    pub device_id: String,
    pub license_key: Option<String>,
    pub activate_time: Option<String>,
    pub expire_time: Option<String>,
    pub has_ever_activated: bool,
    pub cursor_path: Option<String>,
    pub software_enabled: bool,
    pub auto_switch_enabled: bool,
    pub demo_account_index: usize,
    pub consume_logs: Vec<ConsumeLog>,
}

impl Default for AppConfig {
    fn default() -> Self {
        Self {
            device_id: uuid::Uuid::new_v4().to_string(),
            license_key: None,
            activate_time: None,
            expire_time: None,
            has_ever_activated: false,
            cursor_path: None,
            software_enabled: false,
            auto_switch_enabled: false,
            demo_account_index: 0,
            consume_logs: Vec::new(),
        }
    }
}

pub const DEMO_ACCOUNTS: &[&str] = &[
    "learner.one@example.local",
    "learner.two@example.local",
    "learner.three@example.local",
];

pub struct AppState {
    pub inner: Mutex<AppConfig>,
    pub path: PathBuf,
}

impl AppState {
    pub fn load() -> Self {
        let dir = dirs::data_local_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("cursor-assist");
        let _ = fs::create_dir_all(&dir);
        let path = dir.join(CONFIG_FILE);
        let cfg = if path.exists() {
            fs::read_to_string(&path)
                .ok()
                .and_then(|s| serde_json::from_str::<AppConfig>(&s).ok())
                .unwrap_or_default()
        } else {
            AppConfig::default()
        };
        let state = Self {
            inner: Mutex::new(cfg),
            path,
        };
        state.persist();
        state
    }

    pub fn persist(&self) {
        if let Ok(cfg) = self.inner.lock() {
            if let Ok(text) = serde_json::to_string_pretty(&*cfg) {
                let _ = fs::write(&self.path, text);
            }
        }
    }

    pub fn with<R>(&self, f: impl FnOnce(&AppConfig) -> R) -> R {
        let cfg = self.inner.lock().expect("state lock");
        f(&cfg)
    }

    pub fn with_mut<R>(&self, f: impl FnOnce(&mut AppConfig) -> R) -> R {
        let mut cfg = self.inner.lock().expect("state lock");
        let out = f(&mut cfg);
        drop(cfg);
        self.persist();
        out
    }
}

pub fn now_iso() -> String {
    Local::now().format("%Y-%m-%d %H:%M:%S").to_string()
}

pub fn license_is_active(cfg: &AppConfig) -> bool {
    let Some(expire) = cfg.expire_time.as_deref() else {
        return false;
    };
    chrono::NaiveDateTime::parse_from_str(expire, "%Y-%m-%d %H:%M:%S")
        .ok()
        .map(|dt| dt > Local::now().naive_local())
        .unwrap_or(false)
        && cfg.license_key.is_some()
}

pub fn license_payload(cfg: &AppConfig) -> Value {
    let activated = license_is_active(cfg);
    json!({
        "success": true,
        "activated": activated,
        "activateTime": cfg.activate_time,
        "expireTime": cfg.expire_time,
        "key": cfg.license_key,
        "hasEverActivated": cfg.has_ever_activated,
        "deactivatedReason": if activated { Value::Null } else if cfg.has_ever_activated { json!("expired") } else { Value::Null }
    })
}

pub fn current_email(cfg: &AppConfig) -> String {
    DEMO_ACCOUNTS[cfg.demo_account_index % DEMO_ACCOUNTS.len()].to_string()
}

pub fn activate_local_license(cfg: &mut AppConfig, key: &str) -> Result<(), String> {
    let key = key.trim();
    if key.len() < 4 {
        return Err("请输入有效卡号".into());
    }
    let upper = key.to_uppercase();
    if !(upper.starts_with("DEMO") || upper.starts_with("LEARN") || key.len() >= 8) {
        return Err("长度不少于 8 的本地演示卡号".into());
    }
    let now = Local::now();
    cfg.license_key = Some(key.to_string());
    cfg.activate_time = Some(now.format("%Y-%m-%d %H:%M:%S").to_string());
    cfg.expire_time = Some(
        (now + Duration::days(300))
            .format("%Y-%m-%d %H:%M:%S")
            .to_string(),
    );
    cfg.has_ever_activated = true;
    Ok(())
}

pub fn path_looks_like_cursor_install(path: &Path) -> bool {
    if !path.exists() {
        return false;
    }
    let name = path
        .file_name()
        .and_then(|s| s.to_str())
        .unwrap_or("")
        .to_ascii_lowercase();
    if name.contains("cursor") {
        return true;
    }
    path.join("resources/app/package.json").exists()
        || path.join("Contents/Resources/app/package.json").exists()
        || path.join("Cursor.exe").exists()
        || path.join("cursor").exists()
        || path.join("cursor.desktop").exists()
}

pub fn read_cursor_version(install: &Path) -> Option<String> {
    let candidates = [
        install.join("resources/app/product.json"),
        install.join("resources/app/package.json"),
        install.join("Contents/Resources/app/product.json"),
        install.join("Contents/Resources/app/package.json"),
        install.join("package.json"),
    ];
    for file in candidates {
        if let Ok(text) = fs::read_to_string(&file) {
            if let Ok(v) = serde_json::from_str::<Value>(&text) {
                if let Some(ver) = v.get("version").and_then(|x| x.as_str()) {
                    return Some(ver.to_string());
                }
            }
        }
    }
    None
}
