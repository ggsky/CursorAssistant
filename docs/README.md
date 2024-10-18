# Cursor Assistant 二进制逆向与架构还原文档

本项目记录了对 Windows 平台 Tauri 架构可执行文件 `cursor-assist.exe` 进行的完整逆向分析、资产无损还原与架构解构工作。

---

## 目录索引

1. [01. 逆向分析流程与步骤 (01_analysis_workflow.md)](file:///workspace/aa/cursor-id/docs/01_analysis_workflow.md)
   - Linux 环境分析方案与工具配置
   - PE 头与节区分布剖析 (`.text`, `.rdata` 结构)
   - Rust 依赖生态与 91 个第三方 Crate 版本还原
   - 内部工程模块与代码映射 (`ai_assistant_tauri_lib`)
   - Tauri v2 内嵌资产 Brotli 打包机制与精确提取算法
   - IPC 通信指令全量清单 (`#[tauri::command]`)

2. [02. 架构解构与业务功能实现原理 (02_architecture_and_reconstruction.md)](file:///workspace/aa/cursor-id/docs/02_architecture_and_reconstruction.md)
   - 总体系统分层架构 (WebView2 + Tauri Core + Native Modules)
   - 闪屏与多阶段初始化生命周期
   - Cursor 自动更新禁用策略 (`settings.json` 拦截)
   - 系统机器特征重置逻辑 (`MachineGuid` 与 `storage.json` Telemetry)
   - 账号池与会话凭证注入规范 (`WorkosCursorSessionToken`)
   - 卡密授权与中控网络容灾通信设计
   - UI 交互界面与组件还原规范

---

## 提取的前端资源目录 (`extracted/`)

经解密还原的完整前端静态站点文件均存放在 [`extracted/`](file:///workspace/aa/cursor-id/extracted) 目录下，可直接在现代浏览器或 Tauri 环境中预览与运行：

```
extracted/
├── index.html          # 主界面 HTML 结构 (10,127 字节)
├── splash.html         # 启动闪屏 HTML 结构 (3,815 字节)
├── styles.css          # 主界面样式表 (35,690 字节)
├── splash.css          # 闪屏样式表 (1,562 字节)
├── renderer.js         # 前端业务核心逻辑 (77,667 字节)
├── tauri-api.js        # 前后端 IPC 接口桥接层 (8,231 字节)
└── assets/
    ├── icon-16.png     # 16x16 图标
    ├── icon-32.png     # 32x32 图标
    ├── icon-64.png     # 64x64 图标
    ├── icon-256.png    # 256x256 图标
    ├── icon.png        # 主图标 (原图)
    └── tray-icon.png   # 系统托盘图标
```




apt-get update

apt-get install -y \
    pkg-config \
    libwebkit2gtk-4.1-dev \
    libjavascriptcoregtk-4.1-dev \
    libgtk-3-dev \
    build-essential \
    libssl-dev \
    libayatana-appindicator3-dev \
    librsvg2-dev

cd src-tauri
   cargo run

cd /workspace/aa/cursor-id
npx @tauri-apps/cli build
# 或在 src-tauri 目录下：
cargo build --release


