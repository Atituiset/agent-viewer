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
    openExternalSafe(url);
    return { action: "deny" };
  });
  // 安全红线：会话内容是「不可信输入」（agent transcript 里可嵌入任意链接），
  // 绝不允许把整个窗口导航走——导航后的页面会继承 window.api（SSH/凭据能力全在主进程后面）。
  // 应用自身的页面跳转放行（dev 走 localhost，生产是 file://），其余交给系统浏览器。
  win.webContents.on("will-navigate", (event, url) => {
    const internal =
      process.env.AGENT_VIEWER_DEV === "1" ? url.startsWith("http://localhost:3000") : url.startsWith("file://");
    if (!internal) {
      event.preventDefault();
      openExternalSafe(url);
    }
  });
}

/** 只允许 http(s)/mailto 进系统浏览器，挡住 file://、自定义 scheme 等协议级利用。 */
function openExternalSafe(url: string) {
  if (/^https?:\/\//i.test(url) || url.startsWith("mailto:")) {
    shell.openExternal(url);
  }
}

app.whenReady().then(async () => {
  if (process.env.AGENT_VIEWER_SMOKE === "1") {
    // CI 冒烟：主进程 bundle（含 better-sqlite3 原生绑定）能加载并 ready 即通过。
    console.log("SMOKE_OK");
    app.exit(0);
    return;
  }
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
