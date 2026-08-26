import fs from "fs";
import os from "os";
import path from "path";
import type { MachineConfig } from "./types";

export interface SshConfigHost {
  name: string;
  host: string;
  user?: string;
  port?: number;
  identityFile?: string;
}

/**
 * 解析 ~/.ssh/config 的 Host 块。跳过通配符（* ?）和取反（!）条目；
 * 不跟随 Include 指令。块外指令（全局段）忽略——它们会被 ssh 本身继承，
 * 但这里的目的是列出「具体可连的机器」。
 */
export function parseSshConfig(content: string): SshConfigHost[] {
  const hosts: SshConfigHost[] = [];
  let current: SshConfigHost[] = [];
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#")) continue;
    const m = line.match(/^(\S+)\s*[=\s]\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const value = m[2].trim();
    if (key === "host") {
      current = value
        .split(/\s+/)
        .filter((a) => a && !a.startsWith("!") && !/[*?]/.test(a))
        .map((alias) => ({ name: alias, host: alias }));
      hosts.push(...current);
    } else if (current.length) {
      if (key === "hostname" && value) for (const h of current) h.host = value;
      else if (key === "user" && value) for (const h of current) h.user = value;
      else if (key === "port") {
        const p = parseInt(value, 10);
        if (p > 0) for (const h of current) h.port = p;
      } else if (key === "identityfile" && value) {
        // 只取第一个 IdentityFile；~ 展开交给 resolvePrivateKey。
        for (const h of current) if (!h.identityFile) h.identityFile = value;
      }
    }
  }
  return hosts;
}

/** 把 ~/.ssh/config 的 Host 条目转成自动发现的机器（不存在/不可读时返回 []）。 */
export function discoverSshConfigMachines(home = os.homedir()): MachineConfig[] {
  let content: string;
  try {
    content = fs.readFileSync(path.join(home, ".ssh", "config"), "utf-8");
  } catch {
    return [];
  }
  return parseSshConfig(content).map((h) => ({
    id: `sshcfg-${h.name}`,
    name: h.name,
    host: h.host,
    user: h.user || os.userInfo().username,
    port: h.port || 22,
    type: "ssh",
    authMethod: "sshKey",
    sshKey: h.identityFile,
    status: "unknown",
    auto: true,
  }));
}
