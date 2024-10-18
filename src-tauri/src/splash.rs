use crate::startup_trace::trace;
use tauri::{AppHandle, Emitter, Manager};
use tokio::time::{sleep, Duration};

pub async fn run_bootstrap(app: AppHandle) {
    let _ = emit_status(&app, "正在检查本地环境…");
    trace("local self-check");
    sleep(Duration::from_millis(350)).await;

    let _ = emit_status(&app, "正在读取配置…");
    trace("load local config");
    sleep(Duration::from_millis(280)).await;

    let _ = emit_status(&app, "正在准备主界面…");
    sleep(Duration::from_millis(280)).await;

    if let Some(main) = app.get_webview_window("main") {
        let _ = main.show();
        let _ = main.set_focus();
    }
    if let Some(splash) = app.get_webview_window("splash") {
        let _ = splash.close();
    }
    let _ = app.emit("startup-splash-hide", true);
}

fn emit_status(app: &AppHandle, text: &str) -> Result<(), tauri::Error> {
    app.emit("splash-status", text)
}
