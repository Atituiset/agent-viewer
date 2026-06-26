import { app, BrowserWindow, shell } from "electron";
import path from "path";
import { registerIpc } from "./ipc";
import { disposeAll } from "./source-manager";
import { ensureDefaultMachine } from "./bootstrap";

function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    autoHideMenuBar: true,
    icon: path.join(app.getAppPath(), "build", "icon.png"),
    webPreferences: {
      preload: path.join(__dirname, "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // preload 需要 ipcRenderer；contextIsolation 已开
    },
  });

  if (process.env.AGENT_VIEWER_DEV === "1") {
    win.loadURL("http://localhost:3000");
    win.webContents.openDevTools();
  } else {
    win.loadFile(path.join(app.getAppPath(), "out", "index.html"));
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: "deny" };
  });
}

app.whenReady().then(async () => {
  ensureDefaultMachine();
  registerIpc();
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});
app.on("before-quit", (e) => {
  e.preventDefault();
  disposeAll()
    .catch(() => {})
    .finally(() => app.exit(0));
});
