use crate::state::{activate_local_license, license_is_active, license_payload, AppState};
use serde_json::{json, Value};

pub fn get_license_status(state: &AppState) -> Value {
    state.with(license_payload)
}

pub fn activate_license(state: &AppState, key: String) -> Value {
    match state.with_mut(|cfg| activate_local_license(cfg, &key)) {
        Ok(()) => {
            let mut payload = state.with(license_payload);
            payload["success"] = json!(true);
            payload
        }
        Err(error) => json!({ "success": false, "error": error, "activated": false }),
    }
}

pub fn require_license(state: &AppState) -> Result<(), Value> {
    if state.with(license_is_active) {
        Ok(())
    } else {
        Err(json!({
            "success": false,
            "error": "请先激活版卡号",
            "licenseInvalid": true
        }))
    }
}

pub fn get_consume_logs(state: &AppState) -> Value {
    if let Err(e) = require_license(state) {
        return e;
    }
    state.with(|cfg| {
        let today = chrono::Local::now().format("%Y-%m-%d").to_string();
        let today_count = cfg
            .consume_logs
            .iter()
            .filter(|row| row.consume_time.starts_with(&today))
            .count();
        json!({
            "success": true,
            "scope": "all",
            "items": cfg.consume_logs,
            "todayCount": today_count
        })
    })
}
