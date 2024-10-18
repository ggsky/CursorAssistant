/**
 * 界面逻辑与交互渲染脚本
 */

// ==================== 全局状态与常量 ====================
let isActivated = false;
let hasEverActivated = false;
let softwareEnabled = false;
let autoSwitchEnabled = false;
let operationInProgress = false;
let suppressEnableSwitchEvent = false;
let suppressAutoSwitchEvent = false;
let pendingStartupCursorTip = '';

let licenseInfo = {
  activateTime: '',
  expireTime: '',
  key: ''
};

let switchAccountCooldownEnd = 0;
let switchAccountCountdownInterval = null;
let autoSwitchPollTimer = null;
let autoSwitchPollInFlight = false;
let consumeLogsRequestSeq = 0;
let cursorVersion = '';

let permissionInfo = {
  level: 'unknown',
  description: '检测中',
  platform: '',
  elevated: false
};

const AUTO_SWITCH_POLL_MS = 10000;
const CURSOR_AUTO_SWITCH_UNSUPPORTED_MIN = '3.6';
const SWITCH_COOLDOWN_DEFAULT_SEC = 60;

const DIALOG_TITLES = {
  warning: '请注意'
};

let dialogResolve = null;
let toastTimer = null;
let isVersionUpdateDialog = false;

// ==================== Cursor 版本解析与对比 ====================

/**
 * 解析 Cursor 版本号为 [major, minor, patch] 数组
 */
function parseCursorVersionParts(version) {
  if (version == null) return null;
  const match = String(version).trim().match(/^(\d+)(?:\.(\d+))?(?:\.(\d+))?/);
  if (!match) return null;
  return [
    parseInt(match[1], 10) || 0,
    parseInt(match[2] || '0', 10) || 0,
    parseInt(match[3] || '0', 10) || 0
  ];
}

/**
 * 检查 v1 是否大于或等于 v2
 */
function isCursorVersionAtLeast(v1, v2) {
  const p1 = parseCursorVersionParts(v1);
  const p2 = parseCursorVersionParts(v2);
  if (!p1 || !p2) return false;
  for (let i = 0; i < 3; i++) {
    if (p1[i] > p2[i]) return true;
    if (p1[i] < p2[i]) return false;
  }
  return true;
}

/**
 * 判断当前 Cursor 版本是否支持自动换号 (< 3.6 支持)
 */
function isCursorAutoSwitchSupported() {
  if (!cursorVersion) return true;
  return !isCursorVersionAtLeast(cursorVersion, CURSOR_AUTO_SWITCH_UNSUPPORTED_MIN);
}

// ==================== 界面控件状态同步 ====================

/**
 * 同步所有按钮、开关的可用/禁用状态与显示文案
 */
function syncAllButtonsState() {
  const busy = operationInProgress;
  setCursorPathControlsEnabled(isActivated && !busy);

  const softwareEnableSwitch = document.getElementById('softwareEnableSwitch');
  const autoSwitchEnableSwitch = document.getElementById('autoSwitchEnableSwitch');
  const autoSwitchRow = document.getElementById('autoSwitchRow');
  const switchAccountBtn = document.getElementById('switchAccountBtn');
  const resetMachineBtn = document.getElementById('resetMachineBtn');
  const viewConsumeLogsBtn = document.getElementById('viewConsumeLogsBtn');

  const actionDisabled = busy || !isActivated;
  const autoSwitchSupported = isCursorAutoSwitchSupported();

  if (autoSwitchRow) {
    autoSwitchRow.hidden = !autoSwitchSupported;
  }

  if (softwareEnableSwitch) {
    softwareEnableSwitch.disabled = true;
    suppressEnableSwitchEvent = true;
    softwareEnableSwitch.checked = false;
    suppressEnableSwitchEvent = false;
  }

  if (autoSwitchEnableSwitch) {
    autoSwitchEnableSwitch.disabled = actionDisabled || !autoSwitchSupported;
    suppressAutoSwitchEvent = true;
    autoSwitchEnableSwitch.checked = Boolean(autoSwitchEnabled) && autoSwitchSupported;
    suppressAutoSwitchEvent = false;
  }

  if (switchAccountBtn) {
    const isCoolingDown = Date.now() < switchAccountCooldownEnd;
    switchAccountBtn.disabled = actionDisabled || isCoolingDown;

    if (isCoolingDown) {
      const remainingMs = switchAccountCooldownEnd - Date.now();
      const minutes = Math.floor(remainingMs / 60000);
      const seconds = Math.floor((remainingMs % 60000) / 1000);
      switchAccountBtn.textContent = `切换账号 (${minutes}:${seconds.toString().padStart(2, '0')})`;
    } else {
      if (switchAccountCountdownInterval) {
        clearInterval(switchAccountCountdownInterval);
        switchAccountCountdownInterval = null;
      }
      switchAccountBtn.textContent = '切换账号';
    }
  }

  if (resetMachineBtn) {
    resetMachineBtn.disabled = actionDisabled;
  }

  if (viewConsumeLogsBtn) {
    viewConsumeLogsBtn.disabled = actionDisabled;
  }
}

/**
 * 执行耗时操作的包装函数，防止重复触发并统一控制 loading 态
 */
async function runOperation(fn) {
  if (operationInProgress) return;
  operationInProgress = true;
  syncAllButtonsState();
  try {
    return await fn();
  } finally {
    operationInProgress = false;
    syncAllButtonsState();
  }
}

// ==================== 页面启动入口 ====================

document.addEventListener('DOMContentLoaded', async () => {
  if (!window.api) {
    console.error('[renderer] window.api is not ready');
    return;
  }

  initializeWindowControls();
  initializeEventListeners();
  initializeLicenseStatusListener();
  initializePermissionAlert();

  await applyStartupState();
  await loadLatestNotice();
});

// ==================== 公告处理 ====================

/**
 * 加载最新公告内容
 */
async function loadLatestNotice() {
  const noticeCard = document.getElementById('noticeCard');
  const noticeTitle = document.getElementById('noticeTitle');
  const noticeContent = document.getElementById('noticeContent');

  if (!noticeCard || !noticeContent) return;

  if (!window.api?.getLatestNotice) {
    noticeCard.hidden = true;
    return;
  }

  try {
    const res = await window.api.getLatestNotice();
    if (res?.success && res.data?.content) {
      if (noticeTitle) {
        noticeTitle.textContent = '公告';
      }
      noticeContent.className = 'announcement-content notice-html-body';
      noticeContent.innerHTML = normalizeNoticeHtml(res.data.content);
      noticeCard.hidden = false;
    } else {
      noticeCard.hidden = true;
      console.log('公告不可用:', res?.error || '暂无公告数据');
    }
  } catch (err) {
    noticeCard.hidden = true;
    console.error('获取公告失败:', err);
  }
}

/**
 * 规范化公告 HTML，过滤不安全样式并转换为语义化标签
 */
function normalizeNoticeHtml(html) {
  const container = document.createElement('div');
  container.innerHTML = String(html || '');

  container.querySelectorAll('span').forEach((span) => {
    const style = String(span.getAttribute('style') || '').toLowerCase();
    const hasColor = /color\s*:/.test(style);
    if (hasColor) {
      const strong = document.createElement('strong');
      strong.className = 'notice-em';
      while (span.firstChild) {
        strong.appendChild(span.firstChild);
      }
      span.replaceWith(strong);
      return;
    }
    const parent = span.parentNode;
    if (!parent) return;
    while (span.firstChild) {
      parent.insertBefore(span.firstChild, span);
    }
    parent.removeChild(span);
  });

  container.querySelectorAll('[style]').forEach((el) => {
    el.removeAttribute('style');
  });

  container.querySelectorAll('p').forEach((p) => {
    const text = (p.textContent || '').replace(/\s+/g, ' ').trim();
    if (!text) {
      p.remove();
      return;
    }
    p.normalize();
  });

  return container.innerHTML;
}

// ==================== 窗口拖拽与控制 ====================

/**
 * 配置自定义标题栏拖拽移动窗口
 */
function setupHeaderWindowDrag(headerEl) {
  if (!headerEl) return;
  const DRAG_THRESHOLD = 5;

  headerEl.addEventListener('mousedown', (e) => {
    if (e.button !== 0) return;
    if (e.target.closest('[data-no-drag], .window-controls, .window-btn, button, a, input')) return;

    const startX = e.clientX;
    const startY = e.clientY;
    let dragging = false;

    const onMouseMove = async (moveEvent) => {
      if (dragging) return;
      const dx = moveEvent.clientX - startX;
      const dy = moveEvent.clientY - startY;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;

      dragging = true;
      cleanup();

      try {
        const getCurrentWebviewWindow = window.__TAURI__?.webviewWindow?.getCurrentWebviewWindow;
        if (!getCurrentWebviewWindow) return;
        const currentWindow = await getCurrentWebviewWindow();
        await currentWindow.startDragging();
      } catch (err) {
        console.warn('startDragging failed:', err);
      }
    };

    const cleanup = () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', cleanup);
      window.removeEventListener('blur', cleanup);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', cleanup);
    window.addEventListener('blur', cleanup);
  });
}

/**
 * 初始化窗口控制按钮（最小化、托盘、关闭）
 */
function initializeWindowControls() {
  setupHeaderWindowDrag(document.getElementById('appHeader'));

  document.getElementById('minimizeBtn').addEventListener('click', async () => {
    try {
      await window.api.windowActions.minimize();
    } catch (err) {
      console.error('minimize failed:', err);
    }
  });

  const trayBtn = document.getElementById('trayBtn');
  if (trayBtn) {
    trayBtn.addEventListener('click', async () => {
      try {
        await window.api.windowActions.minimizeToTray();
      } catch (err) {
        console.error('minimizeToTray failed:', err);
      }
    });
  }

  document.getElementById('closeBtn').addEventListener('click', async () => {
    const confirmed = await showConfirm('确定要退出程序吗？', {
      title: '退出确认',
      type: 'warning',
      confirmText: '退出',
      cancelText: '取消',
      confirmDanger: true
    });
    if (confirmed) {
      try {
        await window.api.windowActions.requestQuit();
      } catch (err) {
        console.error('requestQuit failed:', err);
        showToast('退出失败，请从任务管理器结束进程或重试');
      }
    }
  });
}

// ==================== 应用信息与启动状态 ====================

/**
 * 渲染应用名称与版本号
 */
function applyAppInfo(appInfo) {
  if (!appInfo || !appInfo.success) return;
  const versionEl = document.getElementById('appVersion');
  if (versionEl) {
    versionEl.textContent = appInfo.versionLabel || (appInfo.version ? `v ${appInfo.version}` : '--');
  }
  if (appInfo.name) {
    document.title = appInfo.name;
  }
}

/**
 * 填充启动时读取的 Cursor 安装目录
 */
function applyStartupCursorPath(data) {
  const input = document.getElementById('cursorPath');
  const path = typeof data?.cursorPath === 'string' ? data.cursorPath.trim() : '';
  if (input && path) {
    input.value = path;
  }
}

/**
 * 从后端配置重新刷新 Cursor 安装目录
 */
async function refreshCursorPathFromConfig() {
  if (!window.api?.getCursorPath) return false;
  try {
    const res = await window.api.getCursorPath();
    if (res?.success && res.cursorPath) {
      const input = document.getElementById('cursorPath');
      if (input) {
        input.value = res.cursorPath;
      }
      return true;
    }
  } catch (err) {
    console.warn('Failed to refresh cursor path from config:', err);
  }
  return false;
}

/**
 * 应用启动时获取的仪表板数据
 */
function applyDashboardFromStartup(data) {
  applyStartupCursorPath(data);

  if (data.account && data.account.success) {
    setAccountNameDisplay(data.account.email);
  } else {
    setAccountNameDisplay('');
  }

  if (data.softwareEnable && data.softwareEnable.success) {
    softwareEnabled = Boolean(data.softwareEnable.enabled);
    if (data.softwareEnable.needsCursorPath) {
      scrollToCursorPathPanel();
      setCursorPathControlsEnabled(true);
    }
  } else {
    softwareEnabled = false;
  }
  updateSoftwareEnableUI();

  if (data.autoSwitch && data.autoSwitch.success) {
    autoSwitchEnabled = Boolean(data.autoSwitch.enabled);
  } else {
    autoSwitchEnabled = false;
  }
  updateAutoSwitchUI();
  void syncAutoSwitchForCursorVersion();
  syncAutoSwitchPoller();

  const seamless = data.seamlessStartup || {};
  if (seamless.reset) {
    softwareEnabled = false;
    updateSoftwareEnableUI();
  }
  if (seamless.needsCursorPath) {
    handleStartupCursorPathRequired({
      reason: seamless.cursorPathReason || seamless.reason
    });
  }

  syncAllButtonsState();
}

/**
 * 获取并应用整体启动状态
 */
async function applyStartupState() {
  await loadAppInfo();

  if (!window.api?.getStartupState) {
    await loadCursorVersion();
    await loadLicenseStatus();
    return;
  }

  let startupData = null;
  for (let i = 0; i < 300; i++) {
    try {
      startupData = await window.api.getStartupState();
      if (startupData?.success) break;
    } catch (err) {
      console.warn('getStartupState attempt failed:', err);
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  if (!startupData?.success) {
    console.warn('Startup state not ready, falling back to legacy load');
    await refreshCursorPathFromConfig();
    await loadCursorVersion();
    await loadLicenseStatus();
    return;
  }

  try {
    applyAppInfo(startupData.appInfo);
    setCursorVersionDisplay(startupData.cursorVersion || '');
    applyStartupCursorPath(startupData);

    const cursorPathInput = document.getElementById('cursorPath');
    if (!cursorPathInput?.value?.trim()) {
      await refreshCursorPathFromConfig();
    }

    if (startupData.updateInfo && startupData.updateInfo.hasUpdate) {
      showVersionUpdateTip(startupData.updateInfo.newVersion, startupData.updateInfo.downloadUrl);
    }

    if (startupData.license && startupData.license.activated) {
      isActivated = true;
      hasEverActivated = true;
      licenseInfo = {
        activateTime: startupData.license.activateTime,
        expireTime: startupData.license.expireTime,
        key: startupData.license.key
      };
      updateLicenseUI();
      applyDashboardFromStartup(startupData);
    } else {
      isActivated = false;
      hasEverActivated = Boolean(startupData.license?.hasEverActivated);
      licenseInfo = {
        activateTime: '',
        expireTime: '',
        key: ''
      };
      updateLicenseUI();
      if (hasEverActivated) {
        applyDashboardFromStartup(startupData);
      } else {
        disableDashboard();
      }
      if (startupData.license?.deactivatedReason) {
        showToast(formatLicenseRevokeMessage(startupData.license.deactivatedReason));
      }
    }
  } catch (err) {
    console.error('Failed to apply startup state:', err);
    isActivated = false;
    disableDashboard();
    await loadAppInfo();
    await refreshCursorPathFromConfig();
    try {
      await loadCursorVersion();
    } catch {
      setCursorVersionDisplay('');
    }
  }
}

/**
 * 设置 Cursor 版本文案展示
 */
function setCursorVersionDisplay(version) {
  const el = document.getElementById('cursorVersion');
  const v = version ? String(version).trim() : '';
  cursorVersion = v;
  if (el) {
    el.textContent = v || '--';
  }
  void syncAutoSwitchForCursorVersion();
}

/**
 * 依据 Cursor 版本同步自动换号状态（若版本过高则自动关闭并禁用）
 */
async function syncAutoSwitchForCursorVersion() {
  const supported = isCursorAutoSwitchSupported();
  const row = document.getElementById('autoSwitchRow');
  if (row) {
    row.hidden = !supported;
  }
  if (supported) {
    syncAllButtonsState();
    return;
  }
  if (!autoSwitchEnabled) {
    syncAllButtonsState();
    syncAutoSwitchPoller();
    return;
  }
  try {
    if (window.api?.setAutoSwitchEnabled) {
      await window.api.setAutoSwitchEnabled(false);
    }
  } catch (err) {
    console.warn('关闭自动换号失败:', err);
  }
  autoSwitchEnabled = false;
  console.log('Cursor >= 3.6，已自动关闭自动换号');
  updateAutoSwitchUI();
  syncAutoSwitchPoller();
  syncAllButtonsState();
}

/**
 * 加载应用基本信息
 */
async function loadAppInfo() {
  if (!window.api?.getAppInfo) return;
  try {
    const res = await window.api.getAppInfo();
    if (res && res.success) {
      const versionEl = document.getElementById('appVersion');
      if (versionEl) {
        versionEl.textContent = res.versionLabel || (res.version ? `v ${res.version}` : '--');
      }
      if (res.name) {
        document.title = res.name;
      }
    }
  } catch (err) {
    console.error('Failed to load app info:', err);
  }
}

/**
 * Windows 下检查重置机器码所需的管理员权限
 */
async function ensureWindowsAdminForReset() {
  if (!window.api?.getCurrentPermissions) return true;
  try {
    const res = await window.api.getCurrentPermissions();
    permissionInfo = {
      level: res?.level || 'unknown',
      description: res?.description || '未知',
      platform: res?.platform || '',
      elevated: Boolean(res?.elevated)
    };
    if (permissionInfo.platform === 'win32' && permissionInfo.level !== 'administrator') {
      showPermissionAlert();
      return false;
    }
  } catch (err) {
    console.warn('Failed to check permissions:', err);
  }
  return true;
}

function showPermissionAlert() {
  const el = document.getElementById('permissionAlertOverlay');
  if (el) el.hidden = false;
}

function closePermissionAlert() {
  const el = document.getElementById('permissionAlertOverlay');
  if (el) el.hidden = true;
}

function initializePermissionAlert() {
  const btn = document.getElementById('permissionAlertOkBtn');
  if (btn) {
    btn.addEventListener('click', closePermissionAlert);
  }
}

/**
 * 获取 Cursor 版本号
 */
async function loadCursorVersion() {
  if (!window.api?.getCursorVersion) return;
  try {
    const res = await window.api.getCursorVersion();
    if (res && res.success && res.version) {
      setCursorVersionDisplay(res.version);
    } else {
      setCursorVersionDisplay('');
    }
  } catch (err) {
    console.error('Failed to load cursor version:', err);
    setCursorVersionDisplay('');
  }
}

// ==================== 授权与卡密处理 ====================

/**
 * 格式化授权失效原因提示
 */
function formatLicenseRevokeMessage(reason) {
  if (!reason) return '授权已失效，请重新激活';
  const str = String(reason);
  if (str.includes('过期') || str === 'expired' || str === 'local_expired') {
    return '授权已过期，请重新激活';
  }
  if (str.endsWith('，请重新激活') || str.endsWith(',请重新激活')) {
    return str;
  }
  return str + '，请重新激活';
}

/**
 * 授权失效时更新全局状态与界面
 */
function applyLicenseInvalidState(message) {
  isActivated = false;
  licenseInfo = {
    activateTime: '',
    expireTime: '',
    key: ''
  };
  setAccountNameDisplay('');
  const expireEl = document.getElementById('expireTime');
  if (expireEl) expireEl.textContent = '--';
  updateLicenseUI();
  disableDashboard();
  if (message) {
    showToast(message);
  }
}

/**
 * 响应中包含 licenseInvalid 字段时的统一拦截处理
 */
function handleLicenseInvalidResponse(res) {
  if (res && res.licenseInvalid) {
    applyLicenseInvalidState(res.error || '授权已失效，请重新激活');
    return true;
  }
  return false;
}

/**
 * 校验本地是否已激活，未激活则提示并滚动到输入框
 */
function requireActivatedLocally() {
  if (!isActivated) {
    showToast('请先激活软件');
    scrollToActivateSection();
    return false;
  }
  return true;
}

/**
 * 启用/禁用 Cursor 安装目录相关输入框和按钮
 */
function setCursorPathControlsEnabled(enabled) {
  const cursorPathInput = document.getElementById('cursorPath');
  const findCursorPathBtn = document.getElementById('findCursorPathBtn');
  const setCursorPathBtn = document.getElementById('setCursorPathBtn');
  if (cursorPathInput) cursorPathInput.disabled = !enabled;
  if (findCursorPathBtn) findCursorPathBtn.disabled = !enabled;
  if (setCursorPathBtn) setCursorPathBtn.disabled = !enabled;
}

/**
 * 启动时若需要配置 Cursor 安装目录时的回调
 */
function handleStartupCursorPathRequired({ reason } = {}) {
  softwareEnabled = false;
  updateSoftwareEnableUI();
  const tip = reason || '未找到 Cursor 安装目录，请先设置';
  if (isActivated) {
    scrollToCursorPathPanel();
    setCursorPathControlsEnabled(true);
    showToast(tip);
  } else {
    pendingStartupCursorTip = tip;
  }
}

/**
 * 监听后端推送的卡密和授权状态变化事件
 */
function initializeLicenseStatusListener() {
  if (window.api?.onStartupCursorPathRequired) {
    window.api.onStartupCursorPathRequired(handleStartupCursorPathRequired);
  }
  if (window.api?.onSoftwareEnableReset) {
    window.api.onSoftwareEnableReset(() => {
      softwareEnabled = false;
      updateSoftwareEnableUI();
    });
  }
  if (window.api?.onLicenseInfoUpdated) {
    window.api.onLicenseInfoUpdated(({ activateTime, expireTime, key }) => {
      if (!isActivated) return;
      if (activateTime) licenseInfo.activateTime = activateTime;
      if (expireTime) licenseInfo.expireTime = expireTime;
      if (key) licenseInfo.key = key;
      updateLicenseUI();
    });
  }
  if (window.api?.onLicenseStatusChanged) {
    window.api.onLicenseStatusChanged(({ activated, reason }) => {
      if (activated) return;
      const licenseKeyInput = document.getElementById('licenseKey');
      if (licenseKeyInput) licenseKeyInput.value = '';
      applyLicenseInvalidState(formatLicenseRevokeMessage(reason));
    });
  }
}

function scrollToActivateSection() {
  const el = document.getElementById('licenseKey');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();
  }
}

function scrollToCursorPathPanel() {
  const el = document.getElementById('cursorPathPanel');
  if (el) {
    el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }
}

// ==================== 邮箱安全防复制保护 ====================

function selectionContainsProtectedEmail() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount === 0) return false;
  const elements = document.querySelectorAll('#accountName, .no-copy-email, .consume-log-col-email');
  for (const el of elements) {
    try {
      if (selection.containsNode(el, true)) return true;
    } catch (e) {}
  }
  return false;
}

function blockEmailCopy(e) {
  if (selectionContainsProtectedEmail()) {
    e.preventDefault();
    return;
  }
  const target = e.target;
  if (!(target instanceof Element)) return;
  if (target.closest('#accountName, .no-copy-email, .consume-log-col-email')) {
    e.preventDefault();
  }
}

function initializeEmailCopyGuards() {
  document.addEventListener('copy', blockEmailCopy, true);
  document.addEventListener('cut', blockEmailCopy, true);
  document.addEventListener(
    'contextmenu',
    (e) => {
      const target = e.target;
      if (!(target instanceof Element)) return;
      if (target.closest('#accountName, .no-copy-email, .consume-log-col-email')) {
        e.preventDefault();
      }
    },
    true
  );
}

// ==================== DOM 事件监听器绑定 ====================

function initializeEventListeners() {
  document.getElementById('activateBtn').addEventListener('click', () => runOperation(activateLicense));

  const softwareEnableSwitch = document.getElementById('softwareEnableSwitch');
  if (softwareEnableSwitch) {
    softwareEnableSwitch.addEventListener('change', onSoftwareEnableSwitchChange);
  }

  const autoSwitchEnableSwitch = document.getElementById('autoSwitchEnableSwitch');
  if (autoSwitchEnableSwitch) {
    autoSwitchEnableSwitch.addEventListener('change', onAutoSwitchEnableChange);
  }

  document.getElementById('switchAccountBtn').addEventListener('click', () => runOperation(switchAccount));
  document.getElementById('resetMachineBtn').addEventListener('click', () => runOperation(resetMachineCode));
  document.getElementById('setCursorPathBtn').addEventListener('click', () => runOperation(saveCursorPath));
  document.getElementById('findCursorPathBtn').addEventListener('click', () => runOperation(findCursorPath));

  const viewConsumeLogsBtn = document.getElementById('viewConsumeLogsBtn');
  if (viewConsumeLogsBtn) {
    viewConsumeLogsBtn.addEventListener('click', () => openConsumeLogsDialog());
  }

  const closeConsumeLogsBtn = document.getElementById('closeConsumeLogsBtn');
  if (closeConsumeLogsBtn) {
    closeConsumeLogsBtn.addEventListener('click', () => closeConsumeLogsDialog());
  }

  const consumeLogsOverlay = document.getElementById('consumeLogsOverlay');
  if (consumeLogsOverlay) {
    consumeLogsOverlay.addEventListener('click', (e) => {
      if (e.target === consumeLogsOverlay) {
        closeConsumeLogsDialog();
      }
    });
  }

  initializeEmailCopyGuards();
  initializeDialogListeners();
}

/**
 * 远程获取授权状态
 */
async function loadLicenseStatus() {
  try {
    const res = await window.api.getLicenseStatus();
    if (res.success && res.activated) {
      isActivated = true;
      hasEverActivated = true;
      licenseInfo = {
        activateTime: res.activateTime,
        expireTime: res.expireTime,
        key: res.key
      };
      updateLicenseUI();
      enableDashboard();
    } else {
      isActivated = false;
      hasEverActivated = Boolean(res.hasEverActivated);
      licenseInfo = {
        activateTime: '',
        expireTime: '',
        key: ''
      };
      updateLicenseUI();
      disableDashboard();
    }
  } catch (err) {
    console.error('Failed to load license status:', err);
    isActivated = false;
    disableDashboard();
  }
}

// ==================== 格式化与显示辅助工具 ====================

/**
 * 卡号脱敏（中间替换为 ****）
 */
function maskCardNo(val) {
  if (!val) return '';
  const str = String(val).trim();
  if (str.length <= 4) return str;
  if (str.length <= 8) {
    return str.slice(0, 2) + '****' + str.slice(-2);
  }
  return str.slice(0, 4) + '****' + str.slice(-4);
}

/**
 * 日期格式化：YYYY-MM-DD HH:mm:ss
 */
function formatDateTime(val) {
  if (!val) return '--';
  try {
    const d = new Date(val);
    const year = d.getFullYear();
    const month = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    const hour = String(d.getHours()).padStart(2, '0');
    const minute = String(d.getMinutes()).padStart(2, '0');
    const second = String(d.getSeconds()).padStart(2, '0');
    return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
  } catch {
    return '--';
  }
}

/**
 * 计算授权剩余天数
 */
function calcRemainingDays(val) {
  if (!val) return '--';
  try {
    const diff = new Date(val).getTime() - Date.now();
    const days = Math.ceil(diff / 86400000);
    if (days <= 0) return '已过期';
    return `${days} 天`;
  } catch {
    return '--';
  }
}

/**
 * 更新授权面板 UI 状态
 */
function updateLicenseUI() {
  const activateBtn = document.getElementById('activateBtn');
  const licenseSummary = document.getElementById('licenseSummary');
  const currentAuthCode = document.getElementById('currentAuthCode');
  const expireTime = document.getElementById('expireTime');
  const remainingDays = document.getElementById('remainingDays');

  if (isActivated) {
    if (activateBtn) activateBtn.textContent = '激活';
    if (licenseSummary) licenseSummary.hidden = false;
    if (currentAuthCode) currentAuthCode.textContent = maskCardNo(licenseInfo.key || '');
    const formattedDate = formatDateTime(licenseInfo.expireTime);
    if (expireTime) expireTime.textContent = formattedDate;
    if (remainingDays) remainingDays.textContent = calcRemainingDays(licenseInfo.expireTime);
  } else {
    if (activateBtn) activateBtn.textContent = '激活';
    if (licenseSummary) licenseSummary.hidden = true;
    if (currentAuthCode) currentAuthCode.textContent = '--';
    if (expireTime) expireTime.textContent = '--';
    if (remainingDays) remainingDays.textContent = '--';
  }
  syncAllButtonsState();
}

/**
 * 激活成功后加载各功能模块数据
 */
function enableDashboard() {
  loadCursorPath();
  loadCursorVersion();
  loadAccountInfo();
  loadSoftwareEnableStatus();
  loadAutoSwitchEnabled();
  if (pendingStartupCursorTip) {
    scrollToCursorPathPanel();
    showToast(pendingStartupCursorTip);
    pendingStartupCursorTip = '';
  }
  syncAllButtonsState();
}

function updateSoftwareEnableUI() {
  const switchEl = document.getElementById('softwareEnableSwitch');
  suppressEnableSwitchEvent = true;
  if (switchEl) {
    switchEl.disabled = true;
    switchEl.checked = false;
  }
  suppressEnableSwitchEvent = false;
  syncAllButtonsState();
}

function updateAutoSwitchUI() {
  const switchEl = document.getElementById('autoSwitchEnableSwitch');
  suppressAutoSwitchEvent = true;
  if (switchEl) {
    switchEl.checked = Boolean(autoSwitchEnabled);
  }
  suppressAutoSwitchEvent = false;
  syncAllButtonsState();
}

async function onSoftwareEnableSwitchChange(e) {
  suppressEnableSwitchEvent = true;
  e.target.checked = false;
  suppressEnableSwitchEvent = false;
}

/**
 * 自动换号开关切换
 */
async function onAutoSwitchEnableChange(e) {
  if (suppressAutoSwitchEvent) return;

  if (!requireActivatedLocally()) {
    suppressAutoSwitchEvent = true;
    e.target.checked = false;
    suppressAutoSwitchEvent = false;
    return;
  }

  if (!isCursorAutoSwitchSupported()) {
    suppressAutoSwitchEvent = true;
    e.target.checked = false;
    suppressAutoSwitchEvent = false;
    showToast('当前 Cursor 版本不支持自动换号');
    return;
  }

  const enabled = Boolean(e.target.checked);
  try {
    const res = await window.api.setAutoSwitchEnabled(enabled);
    if (!res?.success) {
      suppressAutoSwitchEvent = true;
      e.target.checked = autoSwitchEnabled;
      suppressAutoSwitchEvent = false;
      showToast(res?.error || '自动换号设置失败');
      return;
    }
    autoSwitchEnabled = enabled;
    syncAutoSwitchPoller();
    showToast(enabled ? '已开启自动换号' : '已关闭自动换号');
  } catch (err) {
    console.error('Failed to set auto switch:', err);
    suppressAutoSwitchEvent = true;
    e.target.checked = autoSwitchEnabled;
    suppressAutoSwitchEvent = false;
    showToast(err.message || '自动换号设置失败');
  }
}

// ==================== 自动换号轮询控制 ====================

function stopAutoSwitchPoller() {
  if (autoSwitchPollTimer) {
    clearTimeout(autoSwitchPollTimer);
    autoSwitchPollTimer = null;
  }
}

function scheduleNextAutoSwitchPoll() {
  stopAutoSwitchPoller();
  if (!autoSwitchEnabled || !isActivated || !isCursorAutoSwitchSupported()) return;
  autoSwitchPollTimer = setTimeout(() => {
    autoSwitchPollTimer = null;
    void pollAutoSwitchQuota();
  }, AUTO_SWITCH_POLL_MS);
}

function syncAutoSwitchPoller() {
  stopAutoSwitchPoller();
  if (!autoSwitchEnabled || !isActivated || !isCursorAutoSwitchSupported()) return;
  scheduleNextAutoSwitchPoll();
}

/**
 * 轮询当前账号用量配额，当额度耗尽时自动切换账号
 */
async function pollAutoSwitchQuota() {
  if (!autoSwitchEnabled || !isActivated || operationInProgress || autoSwitchPollInFlight) {
    scheduleNextAutoSwitchPoll();
    return;
  }

  if (!isCursorAutoSwitchSupported()) {
    console.log('[Usage Monitor] Cursor >= 3.6，自动停止自动换号');
    autoSwitchEnabled = false;
    try {
      if (window.api?.setAutoSwitchEnabled) {
        await window.api.setAutoSwitchEnabled(false);
      }
    } catch {}
    updateAutoSwitchUI();
    syncAutoSwitchPoller();
    showToast('当前 Cursor 版本不支持自动换号');
    return;
  }

  if (Date.now() < switchAccountCooldownEnd) {
    scheduleNextAutoSwitchPoll();
    return;
  }

  if (!window.api?.getAccountUsage) {
    scheduleNextAutoSwitchPoll();
    return;
  }

  autoSwitchPollInFlight = true;
  try {
    const res = await window.api.getAccountUsage();
    if (!res?.success) {
      console.warn('[Usage Monitor] 查询异常，不换号:', res?.reason || '', res?.error || '');
      const errStr = String(res?.error || '');
      if (/accessToken/i.test(errStr)) {
        showToast('未检测到有效 accessToken，正在自动切换账号...');
        await runOperation(switchAccount);
      }
      return;
    }

    const fmtNum = (val) => (val != null && Number.isFinite(Number(val)) ? Number(val).toFixed(2) : '?');
    const percentStr =
      res.percentUsed != null && Number.isFinite(Number(res.percentUsed)) ? Number(res.percentUsed).toFixed(1) + '%' : '?';

    console.log(
      `[Usage Monitor] ${res.membership || '?'} | 已用 ${percentStr} | 剩余 ${fmtNum(res.remaining)} / 总额 ${fmtNum(
        res.total
      )} (已用额 ${fmtNum(res.used)}) | needs_switch=${Boolean(res.exhausted)}${res.reason ? ' (' + res.reason + ')' : ''}`
    );

    if (!res.exhausted) return;
    await runOperation(switchAccount);
  } catch (err) {
    console.error('auto switch poll failed:', err);
  } finally {
    autoSwitchPollInFlight = false;
    scheduleNextAutoSwitchPoll();
  }
}

// ==================== 状态查询与交互 ====================

async function loadSoftwareEnableStatus() {
  if (!requireActivatedLocally()) return;
  try {
    const res = await window.api.getSoftwareEnableStatus();
    if (handleLicenseInvalidResponse(res)) return;
    if (res.success) {
      softwareEnabled = Boolean(res.enabled);
      if (res.needsCursorPath) {
        scrollToCursorPathPanel();
        setCursorPathControlsEnabled(true);
      }
      updateSoftwareEnableUI();
    }
  } catch (err) {
    console.error('Failed to load software enable status:', err);
  }
}

async function loadAutoSwitchEnabled() {
  if (!window.api?.getAutoSwitchEnabled) return;
  try {
    const res = await window.api.getAutoSwitchEnabled();
    if (res?.success) {
      autoSwitchEnabled = Boolean(res.enabled);
      updateAutoSwitchUI();
      syncAutoSwitchPoller();
    }
  } catch (err) {
    console.error('Failed to load auto switch status:', err);
  }
}

function setAccountNameDisplay(email) {
  const el = document.getElementById('accountName');
  const text = email ? String(email).trim() : '';
  if (el) {
    el.textContent = text || '未登录';
  }
}

async function loadAccountInfo() {
  if (!requireActivatedLocally()) return;
  try {
    const res = await window.api.getAccountInfo();
    if (handleLicenseInvalidResponse(res)) return;
    if (res.success) {
      setAccountNameDisplay(res.email);
    } else {
      setAccountNameDisplay('');
    }
  } catch (err) {
    console.error('Failed to load account info:', err);
    setAccountNameDisplay('');
  }
}

function disableDashboard() {
  if (!hasEverActivated) {
    softwareEnabled = false;
    updateSoftwareEnableUI();
  }
  stopAutoSwitchPoller();
  syncAllButtonsState();
}

/**
 * 激活卡密
 */
async function activateLicense() {
  const keyInput = document.getElementById('licenseKey');
  const key = keyInput ? keyInput.value.trim() : '';
  if (!key) {
    showToast('请输入卡号');
    return;
  }
  showToast('正在激活...');
  const res = await window.api.activateLicense(key);
  if (res.success) {
    isActivated = true;
    hasEverActivated = true;
    licenseInfo = {
      activateTime: res.activateTime,
      expireTime: res.expireTime,
      key: key
    };
    if (keyInput) keyInput.value = '';
    updateLicenseUI();
    enableDashboard();
    showToast('激活成功');
  } else {
    showToast(res.error || '激活失败');
  }
}

async function loadCursorPath() {
  if (!requireActivatedLocally()) return;
  try {
    const res = await window.api.getCursorPath();
    if (handleLicenseInvalidResponse(res)) return;
    if (res.success && res.cursorPath) {
      const input = document.getElementById('cursorPath');
      if (input) {
        input.value = res.cursorPath;
      }
    }
  } catch (err) {
    console.error('Failed to load cursor path:', err);
  }
}

async function findCursorPath() {
  if (!requireActivatedLocally()) return;
  showToast('正在搜索 Cursor 安装目录...');
  const res = await window.api.findCursorPath();
  if (handleLicenseInvalidResponse(res)) return;
  if (res.success && res.cursorPath) {
    const input = document.getElementById('cursorPath');
    if (input) {
      input.value = res.cursorPath;
    }
    const saveRes = await window.api.saveCursorPath(res.cursorPath);
    if (handleLicenseInvalidResponse(saveRes)) return;
    if (saveRes.success) {
      showToast('找到并已保存 Cursor 安装目录');
      await loadCursorVersion();
    } else {
      showToast('找到目录但保存失败，请手动点击保存按钮');
    }
  } else {
    showToast('未找到 Cursor 安装目录，请手动输入目录路径并点击保存');
  }
}

async function saveCursorPath() {
  if (!requireActivatedLocally()) return;
  const input = document.getElementById('cursorPath');
  const path = input ? input.value.trim() : '';
  if (!path) {
    showToast('请输入 Cursor 安装目录');
    return;
  }
  showToast('正在保存...');
  const res = await window.api.saveCursorPath(path);
  if (handleLicenseInvalidResponse(res)) return;
  if (res.success) {
    showToast('Cursor 安装目录已保存');
    await loadSoftwareEnableStatus();
    await loadCursorVersion();
  } else {
    showToast(res.error || '保存失败');
  }
}

/**
 * 切换账号
 */
async function switchAccount() {
  if (!requireActivatedLocally()) return;
  showToast('正在切换账号...');
  const res = await window.api.switchAccount();
  if (handleLicenseInvalidResponse(res)) return;
  if (res.success) {
    setAccountNameDisplay(res.account?.email);
    showToast(res.message || '账号切换成功');
    startSwitchAccountCooldown(res.waitTime);
    if (autoSwitchEnabled) {
      syncAutoSwitchPoller();
    }
  } else {
    showToast(res.error || '切换失败');
  }
}

/**
 * 启动换号冷却倒计时
 */
function startSwitchAccountCooldown(waitTime) {
  const waitNum = Number(waitTime);
  const durationSec = Number.isFinite(waitNum) && waitNum > 0 ? waitNum : SWITCH_COOLDOWN_DEFAULT_SEC;
  const cooldownMs = durationSec * 1000;
  switchAccountCooldownEnd = Date.now() + cooldownMs;

  if (switchAccountCountdownInterval) {
    clearInterval(switchAccountCountdownInterval);
  }

  switchAccountCountdownInterval = setInterval(() => {
    const btn = document.getElementById('switchAccountBtn');
    if (!btn) return;
    const remainingMs = switchAccountCooldownEnd - Date.now();
    if (remainingMs <= 0) {
      clearInterval(switchAccountCountdownInterval);
      switchAccountCountdownInterval = null;
      switchAccountCooldownEnd = 0;
      syncAllButtonsState();
    } else {
      const minutes = Math.floor(remainingMs / 60000);
      const seconds = Math.floor((remainingMs % 60000) / 1000);
      btn.textContent = `切换账号 (${minutes}:${seconds.toString().padStart(2, '0')})`;
    }
  }, 1000);
}

// ==================== 消费日志 ====================

function formatConsumeTime(val) {
  if (!val) return '—';
  const str = String(val).trim();
  if (str.includes('T')) {
    return str.replace('T', ' ').replace(/\.\d+$/, '');
  }
  return str;
}

function closeConsumeLogsDialog() {
  consumeLogsRequestSeq += 1;
  const overlay = document.getElementById('consumeLogsOverlay');
  if (!overlay) return;
  overlay.classList.remove('visible');
  overlay.hidden = true;
  syncAllButtonsState();
}

function renderConsumeLogsRows(tbody, items) {
  tbody.innerHTML = '';
  const fragment = document.createDocumentFragment();
  items.forEach((item, index) => {
    const tr = document.createElement('tr');

    const tdIndex = document.createElement('td');
    tdIndex.className = 'consume-log-col-index';
    tdIndex.textContent = String(index + 1);

    const tdTime = document.createElement('td');
    tdTime.className = 'consume-log-col-time';
    tdTime.textContent = formatConsumeTime(item?.consumeTime);

    const tdEmail = document.createElement('td');
    tdEmail.className = 'consume-log-col-email';
    const accountStr = item?.account ? String(item.account) : '';
    tdEmail.textContent = accountStr || '—';
    if (accountStr) {
      tdEmail.title = accountStr;
    }

    const tdIp = document.createElement('td');
    tdIp.className = 'consume-log-col-ip';
    tdIp.textContent = item?.clientIp ? String(item.clientIp) : '—';

    tr.append(tdIndex, tdTime, tdEmail, tdIp);
    fragment.appendChild(tr);
  });
  tbody.appendChild(fragment);
}

async function openConsumeLogsDialog() {
  if (!requireActivatedLocally()) return;

  const overlay = document.getElementById('consumeLogsOverlay');
  const titleEl = document.getElementById('consumeLogsTitle');
  const summaryLabel = document.getElementById('consumeLogsSummaryLabel');
  const countEl = document.getElementById('consumeLogsCount');
  const table = document.getElementById('consumeLogsTable');
  const tbody = document.getElementById('consumeLogsTbody');
  const emptyEl = document.getElementById('consumeLogsEmpty');
  const viewBtn = document.getElementById('viewConsumeLogsBtn');

  if (!overlay || !tbody || !emptyEl) return;

  const currentSeq = ++consumeLogsRequestSeq;

  if (titleEl) titleEl.textContent = '消费日志';
  if (summaryLabel) summaryLabel.textContent = '换号次数';
  if (countEl) countEl.textContent = '0';
  tbody.innerHTML = '';
  if (table) table.hidden = true;
  emptyEl.hidden = false;
  emptyEl.textContent = '正在加载...';
  if (viewBtn) viewBtn.disabled = true;

  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('visible'));

  try {
    const res = await window.api.getConsumeLogs();
    if (currentSeq !== consumeLogsRequestSeq) return;

    const items = res && Array.isArray(res.items) ? res.items : [];
    const scope = res && res.scope === 'all' ? 'all' : 'today';
    const totalCount = typeof res?.todayCount === 'number' ? res.todayCount : items.length;

    if (titleEl) {
      titleEl.textContent = scope === 'all' ? '消费日志' : '今日消费日志';
    }
    if (summaryLabel) {
      summaryLabel.textContent = scope === 'all' ? '换号次数' : '当日换号次数';
    }
    if (countEl) {
      countEl.textContent = String(totalCount);
    }

    if (!res || !res.success) {
      tbody.innerHTML = '';
      if (table) table.hidden = true;
      emptyEl.hidden = false;
      emptyEl.textContent = (res && res.error) || '查询失败';
      if (res?.error) {
        showToast(res.error);
      }
      return;
    }

    if (items.length === 0) {
      tbody.innerHTML = '';
      if (table) table.hidden = true;
      emptyEl.hidden = false;
      emptyEl.textContent = scope === 'all' ? '暂无消费记录' : '今日暂无消费记录';
      return;
    }

    emptyEl.hidden = true;
    if (table) table.hidden = false;
    renderConsumeLogsRows(tbody, items);
  } catch (err) {
    if (currentSeq !== consumeLogsRequestSeq) return;
    console.error('查询消费日志失败:', err);
    tbody.innerHTML = '';
    if (table) table.hidden = true;
    emptyEl.hidden = false;
    emptyEl.textContent = '查询消费日志异常';
    showToast('查询消费日志异常');
  } finally {
    if (currentSeq === consumeLogsRequestSeq) {
      syncAllButtonsState();
    }
  }
}

// ==================== 重置机器码 ====================

async function resetMachineCode() {
  if (!requireActivatedLocally()) return;
  if (!(await ensureWindowsAdminForReset())) return;

  const confirmed = await showConfirm('重置后将变更本机 Cursor 相关机器标识，确定继续？', {
    title: '重置机器码',
    type: 'warning',
    confirmText: '确定',
    confirmDanger: true
  });
  if (!confirmed) return;

  showToast('正在重置机器码...');
  const res = await window.api.resetMachineCode();
  if (handleLicenseInvalidResponse(res)) return;
  if (res.success) {
    showToast(res.message || '机器码重置成功，请重新打开 Cursor');
  } else {
    const errorMsg = res.error || '重置失败';
    if (/管理员|权限不足/.test(String(errorMsg))) {
      showPermissionAlert();
      return;
    }
    showToast(errorMsg);
  }
}

// ==================== 模态弹窗与 Toast 提示 ====================

function initializeDialogListeners() {
  const overlay = document.getElementById('dialogOverlay');
  const confirmBtn = document.getElementById('dialogConfirmBtn');
  const cancelBtn = document.getElementById('dialogCancelBtn');

  confirmBtn.addEventListener('click', () => {
    const resolver = dialogResolve;
    closeDialog();
    if (isVersionUpdateDialog && resolver && typeof resolver === 'function') {
      resolver(true);
    } else if (resolver) {
      resolver(true);
    }
    isVersionUpdateDialog = false;
  });

  cancelBtn.addEventListener('click', () => {
    const resolver = dialogResolve;
    closeDialog();
    if (resolver) resolver(false);
    isVersionUpdateDialog = false;
  });

  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) {
      cancelBtn.click();
    }
  });
}

function openConfirmDialog({ title, message, type, confirmText, cancelText, confirmDanger }) {
  const overlay = document.getElementById('dialogOverlay');
  const actions = document.getElementById('dialogActions');
  const confirmBtn = document.getElementById('dialogConfirmBtn');
  const cancelBtn = document.getElementById('dialogCancelBtn');
  const titleEl = document.getElementById('dialogTitle');
  const messageEl = document.getElementById('dialogMessage');

  if (titleEl) titleEl.textContent = title || DIALOG_TITLES[type] || '确认';
  if (messageEl) messageEl.textContent = message || '';

  if (actions) {
    actions.hidden = false;
    actions.classList.remove('single');
  }
  if (cancelBtn) {
    cancelBtn.hidden = false;
    cancelBtn.textContent = cancelText || '取消';
  }
  if (confirmBtn) {
    confirmBtn.hidden = false;
    confirmBtn.textContent = confirmText || '确定';
    confirmBtn.classList.toggle('danger', Boolean(confirmDanger));
    confirmBtn.classList.toggle('primary', !confirmDanger);
  }

  if (overlay) {
    overlay.hidden = false;
    requestAnimationFrame(() => overlay.classList.add('visible'));
  }
}

function closeDialog() {
  const overlay = document.getElementById('dialogOverlay');
  const confirmBtn = document.getElementById('dialogConfirmBtn');
  const cancelBtn = document.getElementById('dialogCancelBtn');

  if (overlay) {
    overlay.classList.remove('visible');
    dialogResolve = null;
    setTimeout(() => {
      if (!overlay.classList.contains('visible')) {
        overlay.hidden = true;
      }
    }, 220);
  }
  if (confirmBtn) confirmBtn.onclick = null;
  if (cancelBtn) cancelBtn.onclick = null;
}

function showVersionUpdateTip(newVersion, downloadUrl) {
  const overlay = document.getElementById('dialogOverlay');
  const titleEl = document.getElementById('dialogTitle');
  const messageEl = document.getElementById('dialogMessage');
  const actions = document.getElementById('dialogActions');
  const confirmBtn = document.getElementById('dialogConfirmBtn');
  const cancelBtn = document.getElementById('dialogCancelBtn');

  if (!overlay || !titleEl || !messageEl || !actions) return;

  isVersionUpdateDialog = true;
  dialogResolve = (confirmed) => {
    if (confirmed && downloadUrl) {
      if (window.api && window.api.openExternal) {
        window.api.openExternal(downloadUrl);
      } else {
        window.open(downloadUrl, '_blank');
      }
    }
  };

  titleEl.textContent = '发现新版本';
  if (downloadUrl) {
    messageEl.innerHTML = `检测到新版本 <strong>v${newVersion}</strong>，是否立即下载更新？`;
  } else {
    messageEl.innerHTML = `检测到新版本 <strong>v${newVersion}</strong>，请前往官网下载更新。`;
  }

  if (confirmBtn) {
    confirmBtn.textContent = downloadUrl ? '立即下载' : '我知道了';
    confirmBtn.className = 'btn primary';
  }
  if (cancelBtn) {
    cancelBtn.textContent = downloadUrl ? '以后再说' : '';
    cancelBtn.className = downloadUrl ? 'btn secondary' : '';
    cancelBtn.hidden = !downloadUrl;
  }

  overlay.hidden = false;
  requestAnimationFrame(() => overlay.classList.add('visible'));
}

function showToast(message) {
  const toast = document.getElementById('toast');
  const msgEl = document.getElementById('toastMessage');
  if (!toast || !msgEl) return;

  msgEl.textContent = message;
  toast.classList.add('show');

  if (toastTimer) {
    clearTimeout(toastTimer);
  }
  toastTimer = setTimeout(() => {
    toast.classList.remove('show');
  }, 3000);
}

function showConfirm(
  message,
  { type = 'warning', title, confirmText, cancelText, confirmDanger = false } = {}
) {
  return new Promise((resolve) => {
    dialogResolve = resolve;
    openConfirmDialog({
      title,
      message,
      type,
      confirmText,
      cancelText,
      confirmDanger
    });
  });
}