/**
 * Tauri API 桥接层
 * 封装与 Rust 后端的 IPC 通信与事件监听
 */
(function () {
  const tauri = window.__TAURI__;
  if (!tauri?.core?.invoke) {
    console.error('[tauri-api] window.__TAURI__ not available. Enable app.withGlobalTauri in tauri.conf.json');
    return;
  }

  const { invoke } = tauri.core;
  const listen = tauri.event?.listen?.bind(tauri.event) || (async () => () => {});

  // 事件监听池
  const listeners = {
    'license-status-changed': [],
    'license-info-updated': [],
    'software-enable-reset': [],
    'startup-cursor-path-required': [],
    'splash-status': [],
    'startup-splash-hide': []
  };

  // 注册全局事件监听器
  for (const eventName of Object.keys(listeners)) {
    listen(eventName, (event) => {
      for (const handler of listeners[eventName]) {
        try {
          handler(event.payload);
        } catch (err) {
          console.error(`event handler error (${eventName}):`, err);
        }
      }
    }).catch((err) => {
      console.warn(`listen ${eventName} failed:`, err);
    });
  }

  /**
   * 注册事件回调，返回取消订阅函数
   */
  function addListener(eventName, callback) {
    const list = listeners[eventName] || [];
    list.push(callback);
    listeners[eventName] = list;
    return () => {
      listeners[eventName] = list.filter((cb) => cb !== callback);
    };
  }

  // 导出全局 API 对象
  window.api = {
    // 启动与配置
    getStartupState: () => invoke('get_startup_state'),
    getAppInfo: () => invoke('get_app_info'),
    resetApp: () => invoke('reset_app'),
    openExternal: (url) => invoke('open_external', { url }),
    confirmDialog: (message) => invoke('show_confirm_dialog', { message }),

    // 授权与卡密
    getLicenseStatus: () => invoke('get_license_status'),
    activateLicense: (key) => invoke('activate_license', { key }),

    // 账号与用量
    getAccountInfo: () => invoke('get_account_info'),
    getAccountUsage: () => invoke('get_account_usage'),
    switchAccount: () => invoke('switch_account'),
    getConsumeLogs: () => invoke('get_consume_logs'),

    // 软件状态与开关
    enableSoftware: () => invoke('enable_software'),
    disableSoftware: () => invoke('disable_software'),
    getSoftwareEnableStatus: () => invoke('get_software_enable_status'),

    // 自动换号
    getAutoSwitchEnabled: () => invoke('get_auto_switch_enabled'),
    setAutoSwitchEnabled: (enabled) => invoke('set_auto_switch_enabled', { enabled }),

    // 机器码与系统权限
    resetMachineCode: () => invoke('reset_machine_code'),
    getCurrentPermissions: () => invoke('get_current_permissions'),

    // Cursor 目录与版本
    getCursorPath: () => invoke('get_cursor_path'),
    saveCursorPath: (cursorPath) => invoke('save_cursor_path', { cursorPath }),
    findCursorPath: () => invoke('find_cursor_path'),
    getCursorVersion: () => invoke('get_cursor_version'),

    // 公告
    getLatestNotice: () => invoke('get_latest_notice'),

    // 事件订阅
    onLicenseStatusChanged: (callback) => addListener('license-status-changed', callback),
    onLicenseInfoUpdated: (callback) => addListener('license-info-updated', callback),
    onSoftwareEnableReset: (callback) => addListener('software-enable-reset', callback),
    onStartupCursorPathRequired: (callback) => addListener('startup-cursor-path-required', callback),
    onSplashStatus: (callback) => addListener('splash-status', callback),
    onStartupSplashHide: (callback) => addListener('startup-splash-hide', callback),
    onNavigate: () => {},

    // 窗口控制
    windowActions: {
      minimize: () => invoke('minimize_window'),
      minimizeToTray: () => invoke('minimize_to_tray'),
      requestQuit: () => invoke('request_quit')
    }
  };

  console.log('[tauri-api] window.api ready');
})();