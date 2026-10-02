// main.js — Electron main process
// The main process is Node.js; it creates windows and handles IPC from the renderer.

"use strict";

const { app, BrowserWindow, ipcMain } = require("electron");
const path = require("path");

// electron-updater checks GitHub Releases for new versions.
// Only imported when packaged; dev mode lacks the required update metadata.
const { autoUpdater } = require("electron-updater");

/**
 * Create the main application window.
 * contextIsolation + nodeIntegration=false is the secure default:
 *   - Renderer cannot access Node APIs directly.
 *   - Only what preload.js exposes via contextBridge is available to the page.
 */
function createWindow() {
  const win = new BrowserWindow({
    width: 1000,
    height: 720,
    backgroundColor: "#0f1117",
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,   // isolates renderer from Node context
      nodeIntegration: false,   // renderer cannot use require()
    },
  });

  win.loadFile(path.join(__dirname, "renderer", "index.html"));
}

// IPC: renderer asks for the running app version (shown in sidebar).
// "invoke" is the promise-based form of IPC; handler returns a value directly.
ipcMain.handle("app:version", () => app.getVersion());

// IPC: renderer sends HTTP request options; main process runs fetch (Node 18+).
// The renderer cannot do cross-origin fetch due to CSP, so we proxy here.
ipcMain.handle("http:request", async (_event, opts) => {
  const { method = "GET", url, headers = {}, body } = opts;
  const start = Date.now();

  try {
    const res = await fetch(url, {
      method,
      headers,
      // Only attach body for methods that support it
      body: body && method !== "GET" && method !== "HEAD" ? body : undefined,
    });

    const text = await res.text();
    return {
      ok: res.ok,
      status: res.status,
      statusText: res.statusText,
      time: Date.now() - start,
      body: text,
    };
  } catch (err) {
    return { ok: false, error: err.message };
  }
});

app.whenReady().then(() => {
  createWindow();

  // Auto-update: only meaningful when running as a packaged installer.
  // In dev mode app.isPackaged is false, so we skip to avoid errors.
  if (app.isPackaged) {
    autoUpdater.checkForUpdatesAndNotify();
  }
});

// Quit on all windows closed (standard on Windows/Linux; macOS keeps app alive).
app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
