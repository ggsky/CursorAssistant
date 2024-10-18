# 架构解构与业务功能实现原理

本文档详细记录 `cursor-assist.exe` 核心业务功能的系统架构、底层机制与交互逻辑，为重现与模块化开发提供完整的技术规范。

---

## 1. 总体系统架构

```
┌────────────────────────────────────────────────────────────────────────┐
│                        前端展现层 (WebView2)                           │
│   index.html + splash.html + styles.css + renderer.js + tauri-api.js   │
└────────────────────────────────────┬───────────────────────────────────┘
                                     │ IPC (Tauri v2 invoke / listen)
┌────────────────────────────────────▼───────────────────────────────────┐
│                        Tauri 核心层 (Rust)                             │
│       tauri (v2.11.5) + tauri-runtime-wry + wry (0.55.1) + tao         │
└──────┬─────────────────────────────┬───────────────────────────┬───────┘
       │                             │                           │
┌──────▼──────────────┐   ┌──────────▼────────────┐   ┌──────────▼───────┐
│   授权与网络通信    │   │      系统与环境       │   │  Cursor 专用控制 │
│  - card_api.rs      │   │  - machine_reset.rs   │   │  - cursor.rs     │
│  - http_api.rs      │   │  - device_id.rs       │   │  - cursor_usage  │
│  - startup_trace.rs │   │  - process_util.rs    │   │  - bootstrap.rs  │
└─────────────────────┘   └───────────────────────┘   └──────────────────┘
```

---

## 2. 核心模块与底层实现机制

### 2.1 引导流程与生命周期控制 (`src/commands/bootstrap.rs` & `src/splash.rs`)
1. **多阶段启动**：
   - 第一阶段：显示无边框闪屏窗口 (`splash.html` + `splash.css`)。
   - 第二阶段：后端执行本地自检（检测管理员权限、读取 Cursor 本地安装路径）。
   - 第三阶段：网络自检（拉取远程公告、检查客户端版本更新、建立 HTTP 备用节点池）。
   - 第四阶段：广播 `startup_splash_hide` 事件，关闭闪屏窗口并呈现主界面 (`index.html`)。

2. **自动禁用 Cursor 自身热更新机制**：
   - 目标文件：`%APPDATA%\Cursor\User\settings.json`
   - 执行逻辑：读取配置并备份至 `settings.json.bak`，写入关键字段：
     ```json
     {
       "update.mode": "none",
       "update.enableWindowsBackgroundUpdates": false
     }
     ```
   - 避免 Cursor 在后台静默升级导致机器特征与扩展补丁失效。

---

### 2.2 机器码重置机制 (`src/machine_reset.rs` & `src/device_id.rs`)
该模块用于重置影响客户端唯一设备标识（Telemetry）的系统与本地文件。

#### 1. 注册表键值修改
- **目标路径**：`HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Cryptography`
- **键名**：`MachineGuid`
- **操作**：使用 `uuid::Uuid::new_v4()` 生成全新的 UUID 格式字符串，写入该键值。由于涉及 `HKLM` 写入，该操作强制要求程序以管理员权限（UAC Elevated）运行。

#### 2. 本地 Telemetry 配置文件重置
- **目标文件**：`%APPDATA%\Cursor\User\globalStorage\storage.json`
- **重置字段**（共 4 项）：
  - `telemetry.machineId`：SHA-256 计算的新 Hash
  - `telemetry.macMachineId`：格式化的 Mac 虚拟硬件 ID
  - `telemetry.devDeviceId`：UUID 形式的设备 ID
  - `telemetry.sqmId`：`{UUID}` 形式的会话标识

#### 3. 硬件特征缓存文件清理与隔离
- **目标路径 1**：`C:\ProgramData\CursorPro\cursorpro-device-machine-id.txt`
- **目标路径 2**：`device_machine.json`
- **辅助操作**：清理旧版本客户端可能留存的历史路径（`cursor-renewal-client`、`migrated`）。

#### 4. 前置保护：强制杀死 Cursor 进程
在修改上述任何文件或注册表项前，必须确保目标文件未被锁定：
- 执行系统命令：`tasklist /FI "IMAGENAME eq cursor.exe" /NH`
- 若进程存在，调用 `taskkill /F /IM cursor.exe` 强制退出，随后才允许执行重置。

---

### 2.3 账号池与会话凭证注入 (`src/cursor.rs` & `src/cursor_usage_webview.rs`)

1. **会话 Cookie 规范**：
   - 依赖 Cookie 键名：`WorkosCursorSessionToken`
   - 域名范围：`.cursor.com`

2. **无感换号与额度查询**：
   - **额度接口**：`https://cursor.com/api/usage-summary`
   - **双轨查询机制**：
     - 首选：通过无头 WebView（`wry` 内嵌页面）携带注入的 Session Cookie 请求接口，规避 Cloudflare / 反爬机制检测。
     - 备选：若 WebView 加载超时或失败，回退至 Rust 原生 `reqwest` 客户端直接发起 HTTPS 请求。
   - **切换账号操作**：
     - 向授权中控平台发送无感换号申请；
     - 获得新的有效 Cookie 与 Token；
     - 重写本地 Cursor Session 存储并触发客户端热重载。

---

### 2.4 卡密授权与中控通信 (`src/card_api.rs` & `src/http_api.rs`)

1. **接口定义**：
   - 状态校验：`/seamless/user-status`
   - 公告推送：`/announcements?productType=cursor`
   - 激活验证：POST 数据包含 `{ key, machineCode, cardType }`
   - 消费日志：分页返回换号历史列表 `{ index, time, email, clientIp }`

2. **双通道容灾与备用地址机制**：
   - 默认主站：域名中控
   - 紧急备用节点（硬编码直连）：`https://124.220.5.248/card/java/app-api`
   - 环境变量覆盖支持：`CURSOR_EXE_APP_API_FALLBACKS`

---

## 3. UI 交互设计还原规范

提取自解密后的 `index.html` 与 `styles.css`，界面设计采用 **Dark Theme** 现代化双栏布局：

- **左侧功能引导栏**：
  - 步骤引导卡片（软件激活 → 设置安装路径 → 无感换号）
  - 公告展示面板（支持富文本/HTML 内容动态渲染）
- **右侧控制台核心面板**：
  - 卡密激活模块（输入框、激活按钮、授权码与到期时间展示）
  - Cursor 安装路径配置（自动扫描探测按钮、手动保存）
  - 状态指标仪表盘：
    - 自动换号开关（Slider Switch）
    - 当前登录账号邮箱（带有脱敏处理与防复制样式）
    - 剩余天数 / 额度高亮显示
    - 本地 Cursor 版本号
    - 消费日志查看弹窗（模态表格，支持分页与统计换号次数）
  - 底部操作栏：
    - `切换账号` 按钮（高亮 Primary）
    - `重置机器码` 按钮（危险操作 Danger 红色标识，附带 UAC 提示拦截）
