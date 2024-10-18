use std::time::Instant;
use once_cell::sync::Lazy;

static START: Lazy<Instant> = Lazy::new(Instant::now);

pub fn trace(step: &str) {
    let ms = START.elapsed().as_millis();
    eprintln!("[startup +{ms}ms] {step}");
}
