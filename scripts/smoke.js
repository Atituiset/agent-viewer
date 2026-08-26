// CI 冒烟测试：以 AGENT_VIEWER_SMOKE=1 启动 Electron，主进程加载完
// （含 better-sqlite3 原生绑定）并 ready 后以 0 退出。崩溃/弹错/超时即失败。
// Linux 无显示环境时用 xvfb-run -a 包一层（见 ci.yml）。
const { spawn } = require("child_process");
const path = require("path");
const electronBin = require("electron");

const child = spawn(electronBin, ["--disable-gpu", "--no-sandbox", "."], {
  cwd: path.join(__dirname, ".."),
  env: { ...process.env, AGENT_VIEWER_SMOKE: "1" },
  stdio: ["ignore", "pipe", "pipe"],
});

let out = "";
child.stdout.on("data", (d) => {
  out += d.toString();
});
child.stderr.on("data", (d) => process.stderr.write(d));

const timer = setTimeout(() => {
  child.kill("SIGKILL");
  console.error("smoke: timed out waiting for app ready");
  process.exit(1);
}, 90_000);

child.on("error", (e) => {
  clearTimeout(timer);
  console.error("smoke: spawn failed:", e);
  process.exit(1);
});

child.on("exit", (code) => {
  clearTimeout(timer);
  // 通过条件二选一：退出码 0，或抓到 SMOKE_OK 标记
  // （Windows 上 GUI 子系统进程的 stdout 不一定抓得到）。
  if (code === 0 || out.includes("SMOKE_OK")) {
    console.log("smoke: OK");
    process.exit(0);
  }
  console.error(`smoke: failed (exit ${code})`);
  process.exit(1);
});
