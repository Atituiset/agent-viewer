// agent-session-format@v0.1.0 的 exports 只有 "import" 条件，而 Electron 主进程是
// CommonJS（tsconfig.electron.json: module=commonjs）——require("agent-session-format")
// 会报 ERR_PACKAGE_PATH_NOT_EXPORTED。dist/ 是 ESM，Electron 36 的 Node 22 支持
// require(ESM)，所以补上 "require" 条件（仍指向 ESM dist）即可被主进程加载。
// 上游加上 dual exports 并发版后，本补丁变为 no-op，可连同 postinstall 钩子一起删除。
const fs = require("fs");
const path = require("path");

const manifest = path.join(__dirname, "..", "node_modules", "agent-session-format", "package.json");

try {
  const pkg = JSON.parse(fs.readFileSync(manifest, "utf8"));
  const entry = pkg.exports?.["."];
  if (!entry || entry.require || !entry.import) {
    process.exit(0); // 已有 require 条件（上游已修复）或布局不符预期——都不动。
  }
  entry.require = entry.import;
  fs.writeFileSync(manifest, JSON.stringify(pkg, null, 2) + "\n");
  console.log("patch-agent-session-format: added CJS `require` export condition");
} catch (e) {
  // 依赖缺失（如裁剪过的安装）不该让 npm install 失败；Electron 主进程会在用到时才报错。
  console.warn("patch-agent-session-format: skipped:", e.message);
}
