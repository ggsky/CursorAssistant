use serde_json::{json, Value};

/// 
pub fn reset_machine_code() -> Value {
    json!({
        "success": false,
        "error": "xx。"
    })
}

pub fn get_current_permissions() -> Value {
    let elevated = is_elevated();
    let platform_js = match std::env::consts::OS {
        "windows" => "win32",
        "macos" => "darwin",
        other => other,
    };
    let level = if elevated { "administrator" } else { "user" };
    json!({
        "level": level,
        "description": if elevated { "当前进程具有提升权限" } else { "当前为普通用户权限" },
        "platform": platform_js,
        "elevated": elevated
    })
}

fn is_elevated() -> bool {
    #[cfg(unix)]
    {
        extern "C" {
            fn geteuid() -> u32;
        }
        unsafe { geteuid() == 0 }
    }
    #[cfg(not(unix))]
    {
        false
    }
}
