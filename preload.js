// preload.js — the bridge between main process and renderer
// Runs in the renderer's process but has access to Node/Electron APIs.
// contextBridge.exposeInMainWorld makes selected APIs available as window.api
// without granting the renderer full Node access.

"use strict";

const { contextBridge, ipcRenderer } = require("electron");

// Only expose two specific functions — never expose ipcRenderer itself.
// This limits the renderer's ability to send arbitrary IPC messages.
contextBridge.exposeInMainWorld("api", {
  /**
   * Send an HTTP request via the main process.
   * @param {{ method: string, url: string, headers: object, body: string }} opts
   * @returns {Promise<{ ok: boolean, status: number, statusText: string, time: number, body: string } | { ok: false, error: string }>}
   */
  request: (opts) => ipcRenderer.invoke("http:request", opts),

  /**
   * Get the running app version from package.json.
   * @returns {Promise<string>}
   */
  getVersion: () => ipcRenderer.invoke("app:version"),
});
