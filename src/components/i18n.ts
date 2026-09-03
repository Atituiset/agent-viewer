"use client";

import { useSyncExternalStore } from "react";

export type Locale = "en" | "zh";
type Vars = Record<string, string | number>;

/**
 * 极简 i18n：不做运行时懒加载/复数规则，UI 字符串全部收进两个字典。
 * 选择规则：localStorage 持久化的显式选择 > navigator.language（zh* → zh）> en。
 * SSR/静态预渲染恒为 en，水合后切换到目标语言（Electron 下无感知）。
 */

const en = {
  // nav / page
  "nav.machines": "Machines",
  "nav.addMachine": "+ Add Machine",
  "nav.loading": "Loading…",
  "nav.live": "LIVE",
  "nav.refresh": "Refresh",

  // MachineCards
  "machines.title": "Machines",
  "machines.subtitle": "Select a machine to browse its agent sessions.",
  "machines.empty.title": "No Machines",
  "machines.empty.body": "Add a machine via SSH or open this app locally.",
  "machines.local": "Local machine",
  "machines.autoHint": "Discovered from ~/.ssh/config",
  "machines.remove": "Remove machine",

  // ToolCards
  "tools.title": "Agent Tools",
  "tools.detectedOn": "Detected on",
  "tools.sessions": "sessions",
  "tools.empty.title": "No Agent Tools Found",
  "tools.empty.body": "No supported agent tools detected on this machine.",
  "tools.error.title": "Connection Failed",
  "tools.error.body": "Could not read the tool list from {machine}.",
  "tools.error.sshHint": "For SSH machines: check that sshd is running on the target (sudo service ssh start), credentials/keys are valid, and the network/firewall allows the connection.",

  // SessionList
  "sessions.title": "{tool} Sessions",
  "sessions.count": "{n} sessions",
  "sessions.countOne": "1 session",
  "sessions.filteredFrom": "filtered from {n}",
  "sessions.error": "Failed to list sessions:",
  "sessions.searchPlaceholder": "Search by title, project, model…",
  "sessions.clear": "Clear",
  "sessions.emptySearch": "No sessions match your search.",
  "sessions.empty": "No sessions found for this tool.",
  "sessions.msgs": "{n} msgs",
  "sessions.other": "Other",
  "time.minAgo": "{n}m ago",
  "time.hourAgo": "{n}h ago",
  "time.dayAgo": "{n}d ago",

  // ConversationView
  "conv.error": "Failed to load conversation:",
  "conv.filterPlaceholder": "Filter messages by content, role, tool…",
  "conv.clearFilter": "Clear",
  "conv.viewTimeline": "Timeline",
  "conv.viewSwimlane": "Swimlane",
  "conv.compact": "Compact",
  "conv.full": "Full",
  "conv.noMatch": "No messages match your filter.",
  "conv.meta.model": "Model:",
  "conv.meta.input": "Input:",
  "conv.meta.output": "Output:",
  "conv.meta.cost": "Cost:",
  "conv.meta.dir": "Dir:",

  // message / bubble / nodes
  "role.user": "User",
  "role.assistant": "Assistant",
  "role.system": "System",
  "role.tool": "Tool",
  "msg.thinking": "Thinking ({n} chars)",
  "msg.thinkingTitle": "Thinking",
  "msg.expandContent": "▾ Show all ({n} chars)",
  "msg.collapse": "▴ Collapse",
  "msg.toolCallsSummary": "{n} calls: {tools}",
  "msg.collapseTools": "▴ Collapse tools",

  // ToolCallBlock
  "tool.input": "Input",
  "tool.output": "Output",
  "tool.truncated": "… (truncated)",

  // SwimlaneView
  "swimlane.user": "User",
  "swimlane.main": "Main",

  // AddMachineModal
  "add.title": "Add Remote Machine",
  "add.name": "Name",
  "add.host": "Host",
  "add.port": "Port",
  "add.user": "User",
  "add.auth": "Authentication Method",
  "add.keyPath": "SSH Key Path",
  "add.password": "Password",
  "add.passwordPlaceholder": "Enter password",
  "add.passwordHint": "Encrypted with your OS keychain when available; otherwise stored in plaintext. Prefer SSH keys.",
  "add.cancel": "Cancel",
  "add.submit": "Add Machine",

  // language toggle
  "lang.label": "Language",
} as const;

export type MsgKey = keyof typeof en;

const zh: Record<MsgKey, string> = {
  "nav.machines": "机器",
  "nav.addMachine": "+ 添加机器",
  "nav.loading": "加载中…",
  "nav.live": "LIVE",
  "nav.refresh": "刷新",

  "machines.title": "机器",
  "machines.subtitle": "选择一台机器查看其上的 agent 会话。",
  "machines.empty.title": "暂无机器",
  "machines.empty.body": "通过 SSH 添加一台远程机器，或直接查看本机。",
  "machines.local": "本机",
  "machines.autoHint": "从 ~/.ssh/config 自动发现",
  "machines.remove": "移除机器",

  "tools.title": "Agent 工具",
  "tools.detectedOn": "检测自",
  "tools.sessions": "个会话",
  "tools.empty.title": "未检测到 Agent 工具",
  "tools.empty.body": "这台机器上没有检测到受支持的 agent 工具。",
  "tools.error.title": "读取失败",
  "tools.error.body": "无法从 {machine} 读取工具列表。",
  "tools.error.sshHint": "若是 SSH 远程：检查目标机器 sshd 是否在跑（sudo service ssh start）、账号密码/密钥是否正确、网络/防火墙是否可达。",

  "sessions.title": "{tool} 会话",
  "sessions.count": "{n} 个会话",
  "sessions.countOne": "1 个会话",
  "sessions.filteredFrom": "从 {n} 个中过滤",
  "sessions.error": "读取会话列表失败：",
  "sessions.searchPlaceholder": "按标题、项目、模型搜索…",
  "sessions.clear": "清除",
  "sessions.emptySearch": "没有匹配的会话。",
  "sessions.empty": "该工具暂无会话。",
  "sessions.msgs": "{n} 条",
  "sessions.other": "其他",
  "time.minAgo": "{n} 分钟前",
  "time.hourAgo": "{n} 小时前",
  "time.dayAgo": "{n} 天前",

  "conv.error": "会话加载失败：",
  "conv.filterPlaceholder": "按内容、角色、工具过滤消息…",
  "conv.clearFilter": "清除",
  "conv.viewTimeline": "瀑布",
  "conv.viewSwimlane": "泳道",
  "conv.compact": "摘要",
  "conv.full": "详细",
  "conv.noMatch": "没有匹配过滤条件的消息。",
  "conv.meta.model": "模型：",
  "conv.meta.input": "输入：",
  "conv.meta.output": "输出：",
  "conv.meta.cost": "费用：",
  "conv.meta.dir": "目录：",

  "role.user": "用户",
  "role.assistant": "助手",
  "role.system": "系统",
  "role.tool": "工具",
  "msg.thinking": "Thinking（{n} 字符）",
  "msg.thinkingTitle": "Thinking",
  "msg.expandContent": "▾ 展开全文（{n} 字符）",
  "msg.collapse": "▴ 收起",
  "msg.toolCallsSummary": "{n} 次调用: {tools}",
  "msg.collapseTools": "▴ 收起工具",

  "tool.input": "输入",
  "tool.output": "输出",
  "tool.truncated": "……（已截断）",

  "swimlane.user": "用户",
  "swimlane.main": "主线程",

  "add.title": "添加远程机器",
  "add.name": "名称",
  "add.host": "主机",
  "add.port": "端口",
  "add.user": "用户名",
  "add.auth": "认证方式",
  "add.keyPath": "SSH 私钥路径",
  "add.password": "密码",
  "add.passwordPlaceholder": "输入密码",
  "add.passwordHint": "优先使用系统钥匙串加密存储；不可用时会明文落盘。推荐用 SSH 密钥。",
  "add.cancel": "取消",
  "add.submit": "添加机器",

  "lang.label": "语言",
};

const STORAGE_KEY = "agent-viewer-locale";

function detect(): Locale {
  if (typeof navigator !== "undefined" && navigator.language?.toLowerCase().startsWith("zh")) return "zh";
  return "en";
}

function initial(): Locale {
  try {
    if (typeof localStorage !== "undefined") {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved === "en" || saved === "zh") return saved;
    }
  } catch {}
  return detect();
}

let current: Locale = initial();
const listeners = new Set<() => void>();

export function getLocale(): Locale {
  return current;
}

export function setLocale(locale: Locale) {
  if (locale === current) return;
  current = locale;
  try {
    localStorage.setItem(STORAGE_KEY, locale);
  } catch {}
  for (const fn of listeners) fn();
}

export function subscribeLocale(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function translate(locale: Locale, key: MsgKey, vars?: Vars): string {
  const dict: Record<MsgKey, string> = locale === "zh" ? zh : (en as Record<MsgKey, string>);
  let s = dict[key] ?? (en as Record<MsgKey, string>)[key] ?? key;
  if (vars) for (const [k, v] of Object.entries(vars)) s = s.replaceAll(`{${k}}`, String(v));
  return s;
}

/** 非组件上下文用。 */
export function t(key: MsgKey, vars?: Vars): string {
  return translate(current, key, vars);
}

/**
 * 组件内取翻译函数；切换语言会触发重渲染。
 * SSR 快照恒为 en（静态预渲染一致），水合后切到真实语言。
 */
export function useT() {
  const locale = useSyncExternalStore(subscribeLocale, getLocale, () => "en" as Locale);
  return (key: MsgKey, vars?: Vars) => translate(locale, key, vars);
}
