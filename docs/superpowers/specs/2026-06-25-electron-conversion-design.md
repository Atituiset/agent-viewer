# Electron 桌面化改造设计（agent-viewer）

- 日期：2026-06-25
- 状态：已确认，待出实施计划
- 分支：`feat/electron-desktop`
- 目标读者：实现者

## 1. 背景与目标

agent-viewer 目前是一个 Next.js 16 Web 应用，用浏览器访问本地 HTTP 服务来浏览本机各 Agent CLI（Claude Code / Codex / OpenCode / Gemini / DeepSeek / Hermes）产生的会话历史。需要把它改造成可分发的桌面应用，让其他人在自己的机器上「下载安装即用」，并支持 SSH 远程浏览别的机器上的会话。

### 目标

1. 产出 **Windows（NSIS `.exe`）** 和 **Linux（`.AppImage`）** 安装包，内网直接下载安装。
2. 不内嵌 Next 服务器，做成「干净的 Electron 应用」：静态导出前端 + 主进程承载后端逻辑。
3. 把目前**未实现的多机器 SSH 远程浏览**真正做出来：装在本机，可 SSH 连到他人机器查看其会话。
4. 顺手收敛现有散乱的后端（重复路由、断掉的 `agy`），并补上解析逻辑的单元测试。

### 非目标（本次不做）

- macOS 打包 / Apple 签名公证（用户目标系统为 Windows + Linux）。
- 代码签名 / SmartScreen 消除（内网分发，接受首次启动警告）。
- 自动更新（electron-updater）。
- machines.json 中密码加密（保持现状，仅作为已知安全项记录）。
- README 重写（独立文档任务，不在此范围）。

### 现状关键事实（驱动方案选型）

- 全部页面/组件均为 `"use client"` 客户端组件；数据全部通过 `fetch("/api/...")` 获取；无 SSR-only 特性（无 `cookies()`/`headers()`/`server-only`/`export const dynamic`）。→ 可干净静态导出。
- 后端是 17 个 API 路由，做 `fs` 读取 + OpenCode 的 `better-sqlite3`（原生模块，已在 `serverExternalPackages`）。
- 多机器/SSH：有数据模型（`machines.ts`、`AddMachineModal`）但**未实现**——无任何 SSH 库依赖，所有读取实际只走本机 `os.homedir()`。
- 遗留问题：`claude` 与 `claude-code` 两套重复路由；`agy` 在检测列表里但没有解析器（点进去为空）。

## 2. 选型：方案 B（静态导出 + 主进程 IPC）

放弃「内嵌 Next 服务器」（方案 A，包体 150–200MB、启动慢、架构别扭），采用：

- Next `output: export` 产出纯静态 `out/`，主进程 `loadFile` 加载。
- 所有后端逻辑搬进 Electron 主进程，前端 `fetch("/api/...")` 改为 `window.api.xxx()`（preload 桥接）。
- 反正要新加 SSH 远程浏览，等于本来就要碰全部数据访问代码——顺势在主进程里做干净，留下「本机/远程统一的文件源抽象」。

## 3. 架构

### 3.1 进程模型

```
主进程 (electron/main.ts)
  ├─ app 生命周期、创建 BrowserWindow、注册 IPC
  ├─ FileSource 抽象层
  │    ├─ LocalFileSource  (fs,  home = os.homedir())
  │    └─ SshFileSource    (ssh2 + SFTP, home = 远程 $HOME)
  └─ 工具解析器 (claude/codex/opencode/gemini/deepseek/hermes) + detect
        ↑ 全部接收 FileSource 参数，不再直接 import fs/os

preload (electron/preload.ts)
  └─ contextBridge 暴露 window.api.{machines,tools,sessions}

渲染进程 (Next 静态导出 out/index.html)
  └─ page.tsx + 组件，fetch → window.api.x()
```

- **安全基线**：`contextIsolation: true`、`nodeIntegration: false`、`sandbox: true`（如可行）。渲染进程仅能通过 preload 暴露的白名单 `window.api` 访问能力。
- 后端模块只在主进程被 import，不进入渲染端 bundle。

### 3.2 核心抽象：`FileSource`

这是本次改造最关键的一步。把「在哪台机器上读文件」抽出来，让每个工具解析器变成 `FileSource → 数据` 的纯函数，本机与远程共用同一份代码。

```ts
interface DirEntry { name: string; isDirectory: boolean; }

interface FileSource {
  readonly kind: "local" | "ssh";
  readonly home: string;                              // 本机 os.homedir() / 远程 $HOME
  exists(relOrAbs: string): Promise<boolean>;
  readDir(relOrAbs: string): Promise<DirEntry[]>;     // 含递归所需信息
  readFile(relOrAbs: string): Promise<string>;        // UTF-8
  readFileBuffer?(relOrAbs: string): Promise<Buffer>; // SFTP 拉远程 sqlite 用
  dispose?(): Promise<void>;
}
```

- 路径约定：解析器传入相对家目录的路径（如 `.claude/projects`）。`FileSource` 内部拼 `home`。绝对路径也支持。
- `LocalFileSource`：薄包装 `fs/promises`。
- `SshFileSource`：
  - 维持一条 `ssh2` 连接 + 复用 SFTP。
  - 连接建立后 `exec('echo $HOME')` 解析远程家目录并缓存（ssh2 不自动展开 `~`）。
  - `readFile` 走 SFTP `readFile`；`readDir` 走 SFTP `readdir`；`exists` 用 `stat` 捕获异常。
  - 远程 OpenCode 的 sqlite：SFTP 把 `opencode.db` 下到本地临时文件 → 用 better-sqlite3 打开（只读）→ 关闭 → 删临时文件。与本机现状（copy 到 `/tmp`）一致。
  - 连接按 machineId 缓存；失败重连（指数退避，上限）后仍失败则标记机器离线；机器移除或 app 退出时 `dispose()`。

### 3.3 IPC 接口（收敛现有 17 个路由）

| 方法 | 入参 | 返回 | 说明 |
|------|------|------|------|
| `machines.list` | — | `MachineConfig[]` | 读取 `~/.config/agent-viewer/machines.json` |
| `machines.add` | `Omit<MachineConfig,"id"\|"status">` | `MachineConfig` | 追加并持久化 |
| `machines.remove` | `id` | `{ok:true}` | 移除并持久化、销毁对应 SSH 连接 |
| `tools.detect` | `machineId` | `DetectedTool[]` | 解析该机器的 FileSource → 跑检测 + 计数 |
| `sessions.list` | `machineId, toolId` | `ToolSession[]` | 列某工具的会话 |
| `sessions.read` | `machineId, toolId, sessionId` | `ConversationMessage[]` | 读完整会话 |

- 错误契约统一为 `{ error: string }`，与现有路由一致，渲染端错误处理基本不变。
- 「live 轮询」保持渲染端用 `setInterval` 调 `sessions.read`（现有逻辑），主进程不引入推送。
- 合并 `claude` / `claude-code` 两套为单一 `claude-code` 工具路径（含原 `claude/projects` 的能力）。
- 从检测列表移除 `agy`（无解析器），待有解析器再加回。

## 4. 打包与原生模块

- 打包工具：**electron-builder**。
- 目标：
  - Windows：`nsis` → `.exe` 安装包。
  - Linux：`AppImage`（可选追加 `.deb`）。
- 构建环境：WSL2 / Linux 上用 electron-builder 同时产出 Win + Linux 包（electron-builder 会下载对应平台的 electron 与打包工具链，NSIS 可在 Linux 上生成）。
- 原生模块：`better-sqlite3` 用 **`@electron/rebuild`** 按 Electron 的 Node ABI 重编译，接入构建脚本（`postinstall` 或 build 前）。
- 不签名、不自动更新。产物目录 `release/`。
- 应用图标、`appId`、产物名等元信息在 `package.json` 的 `build` 段配置。

## 5. 文件组织

```
agent-viewer/
├── electron/
│   ├── main.ts              # 生命周期、窗口、注册 IPC、加载 out/
│   ├── preload.ts           # contextBridge → window.api
│   ├── ipc.ts               # 注册 handler，machineId → FileSource 路由
│   ├── fs-source/
│   │   ├── types.ts         # FileSource 接口
│   │   ├── local.ts         # LocalFileSource
│   │   └── ssh.ts           # SshFileSource (ssh2)
│   └── lib/                 # 从 src/lib 搬过来的、仅主进程使用的后端
│       ├── detect.ts
│       ├── machines.ts
│       ├── claude.ts / codex.ts / opencode.ts / gemini.ts / deepseek.ts / hermes.ts
│       └── sqlite.ts        # 用 better-sqlite3 打开（本地路径 or 已下到本地的远程 db）
├── src/
│   ├── lib/types.ts         # 共享类型（渲染端 + 主进程都用）
│   └── app/...              # 渲染端，fetch → window.api
├── next.config.ts           # 新增 output: 'export'
└── package.json             # electron / electron-builder / @electron/rebuild 依赖与脚本
```

`window.api` 的 TypeScript 类型放 `src/lib/types.ts` 或独立的 `electron/api.d.ts`，供渲染端获得类型提示。

## 6. 错误处理

- 所有 IPC handler `try/catch`，失败返回 `{ error: String(e) }`。
- SSH：鉴权失败 / 超时 / 主机不可达 → 返回友好错误，UI 上将该机器标为离线；按 machineId 缓存的连接失败后重连退避。
- better-sqlite3：打开失败（损坏 / 被锁）→ 捕获、返回错误、清理临时文件。
- 缺失的工具目录：返回空/0（现状已如此），保持。

## 7. 测试

项目目前 0 测试。本次借 `FileSource` 抽象补上解析层单测：

- 用 `FakeFileSource`（内存虚拟文件系统）对每个工具解析器写单测：给定若干 `.jsonl`/`.json`/sqlite 场景，断言解析出的会话/消息结构。
- `LocalFileSource`：对临时目录做少量集成测试。
- `SshFileSource`：重点测路径拼接、`$HOME` 解析、错误处理；真实连接行为留作手动验证（引入 ssh 测试服务器成本过高，非本次重点）。
- 工具：vitest。

## 8. 已知风险

1. **`better-sqlite3` 重编译**：Electron 升级或 Node ABI 变动时需重跑 rebuild；构建脚本要可靠。
2. **Next 16 `output: export` 兼容**：需验证 App Router 单路由导出后由 `loadFile` 加载、客户端路由正常（应用仅一个 `/` 路由，风险低）。
3. **WSL2 上出 Windows 包**：electron-builder 在 Linux 上生成 NSIS 一般可行，但首次需下载 Windows 工具链，需联网。
4. **远程 sqlite 一致性**：SFTP 下载瞬间拿到的 db 可能正在被 OpenCode 写入；只读打开 + 异常容错，可接受（与本机现状同等风险）。
5. **明文密码**：machines.json 存 SSH 密码为明文，已知安全项，本次不处理。

## 9. 验收标准

- `npm run dist` 能在当前 WSL2 环境产出 Windows `.exe` 与 Linux `.AppImage`。
- 安装后启动，能看到本机检测到的工具与会话（与现有 Web 版功能等价）。
- 添加一台远程机器（SSH 密码或私钥），能列出并浏览该机器上的会话；OpenCode 的远程 sqlite 能正常打开。
- 解析器单测通过；现有遗留问题（重复路由、`agy`）已收敛。
