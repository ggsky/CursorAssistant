
use crate::state::AppState;

pub fn local_device_id(state: &AppState) -> String {
    state.with(|cfg| cfg.device_id.clone())
}
