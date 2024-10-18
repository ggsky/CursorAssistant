use tauri::image::Image;
use tauri::AppHandle;

pub fn window_icon(_app: &AppHandle) -> Option<Image<'static>> {
    None
}
