use serde_json::{json, Value};

pub fn get_latest_notice() -> Value {
    json!({
        "success": true,
        "data": {
            "content": "<p><strong>1、必须保证用干净的cursor，用过其他家的，请卸载cursor并重装，续杯工具用管理员方式运行；</strong></p>\
<p>2、强烈推荐大家使用3.5.33版本，锁auto；</p>\
<p>3、开启自动换号后，略微有些延迟，提示没额度的时候，直接继续对话就行了，提示 too many free 点重置机器码；</p>\
<p>4、不要随便换号，都是满血额度；续杯工具最新版本：点我下载 。</p>"
        }
    })
}
