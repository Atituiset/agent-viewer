import { app, dialog } from "electron";
import { autoUpdater } from "electron-updater";

/**
 * 自动更新：仅在打包后的应用里启用（dev 模式下 app.isPackaged 为 false）。
 * 后台静默检查/下载，下载完成后弹窗询问是否重启安装。
 *
 * 平台注意：macOS 的自动更新强制要求代码签名，未签名的 mac 包会在
 * check 阶段报错——error 事件里只记日志不打扰用户；Windows(NSIS) 和
 * Linux(AppImage) 的未签名包可以正常更新。
 */
export function setupAutoUpdater(): void {
  if (!app.isPackaged) return;

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  // 防止异常从事件 handler 逃逸成未捕获异常
  autoUpdater.on("error", (e) => console.warn("[updater] 检查/下载更新失败（忽略）:", e.message));
  autoUpdater.on("checking-for-update", () => console.log("[updater] 检查更新…"));
  autoUpdater.on("update-available", (info) => console.log(`[updater] 发现新版本 ${info.version}，后台下载中`));
  autoUpdater.on("update-not-available", () => console.log("[updater] 已是最新"));
  autoUpdater.on("update-downloaded", async (info) => {
    console.log(`[updater] ${info.version} 下载完成`);
    const { response } = await dialog.showMessageBox({
      type: "info",
      title: "更新就绪",
      message: `新版本 ${info.version} 已下载完成`,
      detail: "重启应用即可完成更新。",
      buttons: ["立即重启", "稍后"],
      defaultId: 0,
      cancelId: 1,
    });
    if (response === 0) autoUpdater.quitAndInstall();
  });

  // 启动后稍等片刻再检查，避免拖慢首屏
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch((e) => console.warn("[updater] 首次检查失败（忽略）:", e?.message ?? e));
  }, 10_000);
}
