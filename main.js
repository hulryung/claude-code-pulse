const { app, BrowserWindow, Tray, Menu, ipcMain, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');
const { fetchRateLimits, getMockData, logout } = require('./src/rate-fetcher');
const { startLogin } = require('./src/oauth-login');

const USE_MOCK = process.argv.includes('--mock');
const DEBUG_MODE = process.argv.includes('--debug');

let tray = null;
let mainWindow = null;
let refreshInterval = null;
let lastData = null;
let isLoginInProgress = false;

const REFRESH_MS = 120_000; // 2 minutes

// macOS: don't show dock icon
if (process.platform === 'darwin') {
  app.dock?.hide();
}

function loadTrayIcon() {
  const templatePath = path.join(__dirname, 'assets', 'trayIconTemplate.png');
  const template2xPath = path.join(__dirname, 'assets', 'trayIconTemplate@2x.png');

  if (fs.existsSync(templatePath)) {
    const icon = nativeImage.createFromPath(templatePath);
    if (process.platform === 'darwin') {
      icon.setTemplateImage(true);
    }
    return icon;
  }

  // Fallback: create a minimal icon from embedded base64 data (16x16 white circle)
  const fallbackPng = Buffer.from(
    'iVBORw0KGgoAAAANSUhEUgAAABAAAAAQCAYAAAAf8/9hAAAAP0lEQVQ4T2P8' +
    'z8BQz0BAwMBAAGCSwKBhwICBMRgMGDEYMGIwYMDAQIQBDGiSGPAawIjXFQxE' +
    'GMCAJolhAAALqAkRKYlDqwAAAABJRU5ErkJggg==',
    'base64'
  );
  const icon = nativeImage.createFromBuffer(fallbackPng, { width: 16, height: 16 });
  if (process.platform === 'darwin') {
    icon.setTemplateImage(true);
  }
  return icon;
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 380,
    height: 500,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    alwaysOnTop: true,
    transparent: false,
    backgroundColor: '#0d1117',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'renderer', 'index.html'));

  mainWindow.on('blur', () => {
    if (mainWindow && mainWindow.isVisible() && !isLoginInProgress) {
      mainWindow.hide();
    }
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

function positionWindowNearTray() {
  if (!tray || !mainWindow) return;

  const trayBounds = tray.getBounds();
  const windowBounds = mainWindow.getBounds();
  const display = screen.getDisplayNearestPoint({ x: trayBounds.x, y: trayBounds.y });
  const workArea = display.workArea;

  let x = Math.round(trayBounds.x + trayBounds.width / 2 - windowBounds.width / 2);
  let y;

  if (process.platform === 'darwin') {
    // macOS: tray is at top, window drops down
    y = trayBounds.y + trayBounds.height + 4;
  } else {
    // Windows: tray is at bottom, window goes up
    y = trayBounds.y - windowBounds.height - 4;
  }

  // Keep within screen bounds
  x = Math.max(workArea.x, Math.min(x, workArea.x + workArea.width - windowBounds.width));
  y = Math.max(workArea.y, Math.min(y, workArea.y + workArea.height - windowBounds.height));

  mainWindow.setPosition(x, y, false);
}

function showWindow() {
  if (!mainWindow) {
    createWindow();
  }
  positionWindowNearTray();
  mainWindow.show();
  mainWindow.focus();
}

function toggleWindow() {
  if (mainWindow && mainWindow.isVisible()) {
    mainWindow.hide();
  } else {
    showWindow();
  }
}

function updateTrayTooltip(data) {
  if (!tray) return;

  if (data.error) {
    tray.setToolTip('Claude Pulse - Error');
    return;
  }

  const sessionPct = (data.session.utilization * 100).toFixed(0);
  const weeklyPct = (data.weekly.utilization * 100).toFixed(0);
  tray.setToolTip(`Claude Pulse\nSession: ${sessionPct}% | Week: ${weeklyPct}%`);
}

async function doRefresh() {
  try {
    const data = USE_MOCK ? getMockData() : await fetchRateLimits();
    lastData = data;
    updateTrayTooltip(data);
    if (mainWindow) {
      mainWindow.webContents.send('auto-refresh-data', data);
    }
    return data;
  } catch (e) {
    const errorData = {
      error: true,
      errorType: 'unexpected',
      errorMessage: `Unexpected error: ${e.message}`,
    };
    if (mainWindow) {
      mainWindow.webContents.send('auto-refresh-data', errorData);
    }
    return errorData;
  }
}

app.whenReady().then(() => {
  const icon = loadTrayIcon();
  tray = new Tray(icon);
  tray.setToolTip('Claude Pulse - Loading...');

  tray.on('click', toggleWindow);
  tray.on('right-click', () => {
    const contextMenu = Menu.buildFromTemplate([
      { label: 'Show', click: showWindow },
      { label: 'Refresh Now', click: () => doRefresh() },
      { type: 'separator' },
      { label: 'Quit Claude Pulse', click: () => app.quit() },
    ]);
    tray.popUpContextMenu(contextMenu);
  });

  createWindow();

  // IPC handlers
  ipcMain.handle('fetch-rate-limits', async () => {
    return doRefresh();
  });

  ipcMain.handle('get-settings', () => {
    return { refreshInterval: REFRESH_MS, debug: DEBUG_MODE };
  });

  ipcMain.handle('start-login', async () => {
    isLoginInProgress = true;
    try {
      await startLogin();
      // After successful login, fetch rate limits immediately
      const data = await doRefresh();
      return { success: true, data };
    } catch (e) {
      return { success: false, error: e.message };
    } finally {
      isLoginInProgress = false;
    }
  });

  ipcMain.handle('logout', () => {
    logout();
    return { success: true };
  });

  ipcMain.on('quit-app', () => {
    app.quit();
  });

  // Auto-refresh
  refreshInterval = setInterval(doRefresh, REFRESH_MS);

  // Initial fetch after window is ready
  mainWindow.webContents.on('did-finish-load', () => {
    doRefresh();
  });
});

app.on('window-all-closed', (e) => {
  // Don't quit - keep running in tray
});

app.on('before-quit', () => {
  if (refreshInterval) clearInterval(refreshInterval);
});
