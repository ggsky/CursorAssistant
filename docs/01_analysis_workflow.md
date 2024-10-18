# Tauri 应用程序 (Windows EXE) Linux 环境静态分析全流程

本报告记录针对 Windows 平台 Tauri 架构二进制可执行文件 `cursor-assist.exe` 在 Linux 环境下的完整静态逆向与架构分析步骤。

---

## 目录
1. [分析环境与前置准备](#1-分析环境与前置准备)
2. [第一阶段：文件格式识别与 PE 结构分析](#2-第一阶段文件格式识别与-pe-结构分析)
3. [第二阶段：Rust 后端依赖与内部符号还原](#3-第二阶段rust-后端依赖与内部符号还原)
4. [第三阶段：Tauri v2 内嵌资产打包机制与提取](#4-第三阶段tauri-v2-内嵌资产打包机制与提取)
5. [第四阶段：前端业务逻辑与混淆代码解密](#5-第四阶段前端业务逻辑与混淆代码解密)
6. [第五阶段：前后端通信 (IPC) 接口与数据流还原](#6-第五阶段前后端通信-ipc-接口与数据流还原)

---

## 1. 分析环境与前置准备

### 环境规格
- 操作系统：Linux x86_64
- 基础工具：`python3`, `rustc / cargo`, `brotli`, `strings`, `node`
- 分析目标：`/workspace/aa/cursor-id/cursor-assist.exe` (文件体积: 8,130,362 字节，约 7.75 MB)

### 前置工具与库安装
```bash
# 安装 Python brotli 解压支持
pip install brotli

# 验证 Rust 工具链 (用于精准调用与 Tauri 运行时完全一致的 brotli 编解码)
rustc --version
cargo --version
```

---

## 2. 第一阶段：文件格式识别与 PE 结构分析

### 2.1 PE 头部与节区解析
通过自编写 Python 脚本解析 PE（Portable Executable）头信息，明确程序架构与各节区布局：

```python
import struct

with open('cursor-assist.exe', 'rb') as f:
    data = f.read()

e_lfanew = struct.unpack_from('<I', data, 0x3C)[0]
machine, num_sections = struct.unpack_from('<HH', data, e_lfanew + 4)
# Machine 0x8664 = x86_64 (AMD64)
# ImageBase = 0x140000000
```

### 2.2 节区分布结果
| 节区名 | 虚拟地址 (VA) | 虚拟大小 | 原始数据指针 (Raw Pointer) | 原始数据大小 | 用途说明 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `.text` | `0x1000` | 0x9D2A0 | `0x000400` | 0x9D400 (629 KB) | 机器执行代码段 |
| `.data` | `0x9F000` | 0x00C00 | `0x09D800` | 0x00C00 (3 KB) | 可读写全局数据 |
| `.rdata` | `0xA0000` | 0x6A56A8 | `0x09E400` | 0x6A5800 (6.65 MB) | 只读数据、常量、内嵌前端资产 |
| `.pdata` | `0x746000` | 0x04ED8 | `0x743C00` | 0x05000 (20 KB) | 异常处理表 |
| `.xdata` | `0x74B000` | 0x0A418 | `0x748C00` | 0x0A600 (41 KB) | 异常处理展开信息 |
| `.idata` | `0x757000` | 0x0200C | `0x753200` | 0x02200 (8.5 KB) | 导入表 (Win32 API) |
| `.rsrc` | `0x75B000` | 0x16CF0 | `0x755600` | 0x16E00 (91 KB) | Windows 原生资源 (图标、版本号) |
| `.reloc` | `0x772000` | 0x00C9C | `0x76C400` | 0x00E00 (3.5 KB) | 重定位表 |

> **关键发现**：`.rdata` 占了二进制总体积的 85% 以上（6.65 MB），说明所有核心前端打包资源、字符串常量及第三方库元数据均集中存储在 `.rdata` 段中。

---

## 3. 第二阶段：Rust 后端依赖与内部符号还原

### 3.1 Crate 依赖树与版本还原
Rust 编译器在生成 Panic/追踪路径时会固化构建时的 `.cargo/registry` 路径。通过扫描 `index.crates.io-*` 路径模式，完整提取出后端的全部 91 个依赖库及精确版本：

- **核心桌面框架**：
  - `tauri: 2.11.5` (已确认为最新的 Tauri v2 架构)
  - `tauri-runtime-wry: 2.11.4`
  - `tauri-utils: 2.9.3`
  - `wry: 0.55.1` (基于 WebView2)
  - `tao: 0.35.3` (跨平台窗口管理)
- **Tauri 官方插件**：
  - `tauri-plugin-dialog: 2.7.1`
  - `tauri-plugin-opener: 2.5.4`
- **网络与并发核心**：
  - `reqwest: 0.12.28` (开启了 rustls)
  - `tokio: 1.52.3`
  - `hyper: 1.10.1`
  - `rustls: 0.23.41`
- **系统底层交互与 Windows 平台接口**：
  - `windows: 0.61.3`
  - `windows-core: 0.61.2`
  - `windows-strings: 0.4.2`
  - `winreg: 0.52.0` (用于 Windows 注册表读写)
  - `tray-icon: 0.24.1` (系统托盘图标)
  - `window-vibrancy: 0.6.0` (窗口磨砂/模糊特效)
  - `rfd: 0.16.0` (原生对话框)
- **数据结构与压缩**：
  - `phf: 0.13.1` (完美哈希查找，Tauri 资源寻址核心)
  - `brotli-decompressor: 5.0.3` (资源解压关键依据)
  - `serde: 1.0.228`, `serde_json: 1.0.150`

### 3.2 业务源码模块映射 (Module Mapping)
通过抓取 `src\*.rs` 代码行定位字符串，还原出程序内部 crate `ai_assistant_tauri_lib` 的工程代码组织结构：

```
ai_assistant_tauri_lib (Rust)
├── src/
│   ├── lib.rs                       # 主入口、Tauri AppState 与 Builder 初始化
│   ├── card_api.rs                  # 授权激活与卡密核销接口调用
│   ├── commands/
│   │   ├── mod.rs                   # IPC 命令注册分发中心
│   │   └── bootstrap.rs             # 启动状态机、配置检查与环境初始化
│   ├── cursor.rs                    # Cursor 进程扫描、执行参数、ShellExecute
│   ├── cursor_usage_webview.rs      # Cursor API 使用情况抓取 (基于 WebView/Reqwest)
│   ├── device_id.rs                 # 机器码计算、唯一标识生成
│   ├── http_api.rs                  # 业务后端 HTTP 客户端 (备用节点、心跳、公告)
│   ├── icons.rs                     # 动态托盘与窗口图标渲染
│   ├── machine_reset.rs             # 机器码与环境重置核心 (注册表与配置文件清理)
│   │   └── win_linux.rs             # 平台特定的配置目录与注册表重置逻辑
│   ├── process_util.rs              # 进程杀除 (taskkill)、退出控制
│   ├── splash.rs                    # 启动过渡闪屏窗口控制
│   └── startup_trace.rs             # 启动链路埋点与耗时监控
```

---

## 4. 第三阶段：Tauri v2 内嵌资产打包机制与提取

### 4.1 Tauri v2 资源内嵌机制逆向
查阅 Tauri 2.11.5 官方源码 `crates/tauri-codegen/src/embedded_assets.rs` 与 `crates/tauri-utils/src/assets.rs`，明确内嵌资源的生成规律：
1. **压缩算法**：默认开启 `brotli` 压缩。
2. **寻址结构**：使用 `phf::Map<&'static str, &'static [u8]>` 构建编译期完美哈希表。
3. **内存排布**：资源文件路径以 UTF-8 字符串保存在 `.rdata` 段中，数据体紧跟其后；未压缩的二进制文件（如 PNG 图标）直接保留原始字节流；文本文件（HTML、CSS、JS）则存储为 Brotli 压缩数据流。

### 4.2 资源位置精确定位表
通过分析 `.rdata` 中连续的资源声明与 Brotli 流头，精确测定各项资源在可执行文件中的绝对偏移与长度：

| 资源逻辑路径 | 文件绝对起始偏移 | 头部偏移 (Payload) | 压缩包大小 (字节) | 解压后大小 (字节) | 存储格式 |
| :--- | :--- | :--- | :--- | :--- | :--- |
| `/tauri-api.js` | `0x4A52FA` | `0x4A5307` | 3,082 | 8,231 | Brotli 压缩 |
| `assets/icon-32.png` | `0x4A5F27` | `0x4A5F27` | - | 2,667 | PNG 原生格式 |
| `assets/icon.png` | `0x4A69A7` | `0x4A69A7` | - | 620,731 | PNG 原生格式 |
| `assets/icon-256.png` | `0x53E27B` | `0x53E27B` | - | 74,284 | PNG 原生格式 |
| `assets/icon-16.png` | `0x5504BE` | `0x5504BE` | - | 734 | PNG 原生格式 |
| `/index.html` | `0x55079D` | `0x5507A8` | 2,266 | 10,127 | Brotli 压缩 |
| `/splash.html` | `0x551099` | `0x5510A5` | 1,262 | 3,815 | Brotli 压缩 |
| `/styles.css` | `0x551593` | `0x55159E` | 6,062 | 35,690 | Brotli 压缩 |
| `assets/icon-64.png` | `0x552D62` | `0x552D62` | - | 8,050 | PNG 原生格式 |
| `/splash.css` | `0x554CD5` | `0x554CE0` | 596 | 1,562 | Brotli 压缩 |
| `/renderer.js` | `0x554F34` | `0x554F40` | 21,269 | 77,667 | Brotli 压缩 |
| `assets/tray-icon.png` | `0x55BF90` | `0x55BF90` | - | 24,241 | PNG 原生格式 |

### 4.3 自动化提取脚本
编写专用 Python 提取工具，无损还原全部前端资源至 `extracted/` 目录：
```python
import brotli
import os

with open('cursor-assist.exe', 'rb') as f:
    data = f.read()

# 导出逻辑见 scratch/export_all_assets.py
# 产物完整存放在 /workspace/aa/cursor-id/extracted/
```

---

## 5. 第五阶段：前后端通信 (IPC) 接口与数据流还原

通过对 `tauri-api.js` 的混淆解密，还原出注入到 `window.api` 上的所有 IPC Command 调用及前端监听事件。

### 5.1 前端暴露给后端的 IPC Commands (Rust `#[tauri::command]`)

| IPC Command 名称 | 参数列表 | 返回值 / 功能描述 | 对应 Rust 源码文件 |
| :--- | :--- | :--- | :--- |
| `get_startup_state` | 无 | 获取引导初始化阶段状态机进度 | `src\commands\bootstrap.rs` |
| `get_license_status` | 无 | 查询卡密授权有效性、卡种、到期时间 | `src\card_api.rs` |
| `activate_license` | `{ key: string }` | 激活卡号/授权码 | `src\card_api.rs` |
| `get_account_info` | 无 | 获取当前登录账号邮箱与剩余额度状态 | `src\commands\mod.rs` |
| `get_account_usage` | 无 | 查询 Cursor API 实际调用量摘要 | `src\cursor_usage_webview.rs` |
| `switch_account` | 无 | 执行无感切换账号 (轮换账号池凭证) | `src\commands\mod.rs` |
| `enable_software` | 无 | 启用增强辅助特性 | `src\commands\mod.rs` |
| `disable_software` | 无 | 停用增强辅助特性 | `src\commands\mod.rs` |
| `get_software_enable_status` | 无 | 获取当前启用开关状态 | `src\commands\mod.rs` |
| `get_auto_switch_enabled` | 无 | 查询是否开启自动定时换号 | `src\commands\mod.rs` |
| `set_auto_switch_enabled` | `{ enabled: bool }` | 开启或关闭自动换号功能 | `src\commands\mod.rs` |
| `reset_machine_code` | 无 | 重置系统 MachineGuid、硬件特征与 Cursor telemetry | `src\machine_reset.rs` |
| `get_current_permissions` | 无 | 检查当前是否拥有管理员运行权限 (UAC) | `src\machine_reset.rs` |
| `get_latest_notice` | 无 | 拉取官方公告消息与弹窗提示 | `src\http_api.rs` |
| `get_consume_logs` | 无 | 拉取卡号换号消费历史日志 (时间/邮箱/IP) | `src\card_api.rs` |
| `get_cursor_path` | 无 | 获取本地 Cursor 安装路径 | `src\cursor.rs` |
| `save_cursor_path` | `{ cursorPath: string }` | 手动保存用户指定的 Cursor 安装路径 | `src\cursor.rs` |
| `find_cursor_path` | 无 | 自动探测磁盘上已安装的 Cursor 路径 | `src\cursor.rs` |
| `get_app_info` | 无 | 获取助手客户端自身版本号与元数据 | `src\commands\mod.rs` |
| `get_cursor_version` | 无 | 检测当前本地 Cursor 版本号 | `src\cursor.rs` |
| `reset_app` | 无 | 重置助手本地缓存配置 | `src\commands\mod.rs` |
| `open_external` | `{ url: string }` | 通过系统默认浏览器打开指定网址 | `src\commands\mod.rs` |
| `confirm_dialog` | `{ message: string }` | 弹出系统确认对话框 | `src\commands\mod.rs` |
| `minimize_window` | 无 | 最小化当前主窗口 | `src\commands\mod.rs` |
| `minimize_to_tray` | 无 | 隐藏到系统任务栏托盘区域 | `src\commands\mod.rs` |
| `request_quit` | 无 | 安全退出助手进程 | `src\process_util.rs` |

### 5.2 后端向前端广播的事件 (Tauri Events)
- `license_status_changed`：卡密授权变更事件（如过期、刷新）
- `license_info_updated`：授权详细数据刷新
- `software_enable_reset`：重置状态更新
- `startup_cursor_path_required`：首次启动未找到 Cursor 路径通知
- `splash_status`：启动进度条与文字提示广播
- `startup_splash_hide`：闪屏窗口关闭、主窗口呈现通知
