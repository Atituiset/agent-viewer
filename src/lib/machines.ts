import fs from "fs";
import path from "path";
import os from "os";
import { safeStorage } from "electron";
import type { MachineConfig } from "./types";

const CONFIG_DIR = path.join(os.homedir(), ".config", "agent-viewer");
const MACHINES_FILE = path.join(CONFIG_DIR, "machines.json");

// machines.json 中密码字段的加密标记前缀。
const ENC_PREFIX = "enc:v1:";

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

/**
 * 用 Electron safeStorage 加密 secret（OS 级 keychain/DPAPI）。
 * safeStorage 不可用（如某些 Linux 无 libsecret）时返回原文——
 * 调用方 UI 应引导用户优先用 sshKey 认证。
 */
export function protectSecret(secret: string | undefined): string | undefined {
  if (!secret) return secret;
  if (!safeStorage?.isEncryptionAvailable()) return secret;
  try {
    return ENC_PREFIX + safeStorage.encryptString(secret).toString("base64");
  } catch {
    return secret;
  }
}

function unprotectSecret(value: string | undefined): string | undefined {
  if (!value || !value.startsWith(ENC_PREFIX)) return value;
  if (!safeStorage?.isEncryptionAvailable()) {
    // 换机器/环境后解不开：返回空，避免把密文当密码发出去。
    return undefined;
  }
  try {
    return safeStorage.decryptString(Buffer.from(value.slice(ENC_PREFIX.length), "base64"));
  } catch {
    return undefined;
  }
}

function sanitizeForDisk(machines: MachineConfig[]): MachineConfig[] {
  return machines.map((m) => ({
    ...m,
    password: protectSecret(m.password),
    // sshKey 字段存的是私钥「路径」而非内容时无需加密；这里约定它就是路径。
  }));
}

function restoreFromDisk(machines: MachineConfig[]): MachineConfig[] {
  return machines.map((m) => ({ ...m, password: unprotectSecret(m.password) }));
}

/** 原子写：先写临时文件再 rename，崩溃不会留下截断的配置文件。 */
function atomicWrite(file: string, data: string) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

export function loadMachines(): MachineConfig[] {
  ensureConfigDir();
  if (!fs.existsSync(MACHINES_FILE)) {
    const defaults = getDefaultMachines();
    saveMachines(defaults);
    return defaults;
  }
  try {
    const data = JSON.parse(fs.readFileSync(MACHINES_FILE, "utf-8")) as MachineConfig[];
    if (!Array.isArray(data)) throw new Error("bad format");
    return restoreFromDisk(data);
  } catch {
    return getDefaultMachines();
  }
}

export function saveMachines(machines: MachineConfig[]) {
  ensureConfigDir();
  atomicWrite(MACHINES_FILE, JSON.stringify(sanitizeForDisk(machines), null, 2));
}

export function addMachine(machine: Omit<MachineConfig, "id" | "status">): MachineConfig {

  const machines = loadMachines();
  let id = `ssh-${machine.host}-${machine.port}`;
  while (machines.some((m) => m.id === id)) id += `-${Math.random().toString(36).slice(2, 6)}`;
  const newMachine: MachineConfig = {
    ...machine,
    id,
    status: "unknown",
  };
  machines.push(newMachine);
  saveMachines(machines);
  return newMachine;
}

export function removeMachine(id: string) {
  const machines = loadMachines().filter((m) => m.id !== id);
  saveMachines(machines);
}

export function getDefaultMachines(): MachineConfig[] {
  return [
    {
      id: `local-${os.hostname()}`,
      name: os.hostname(),
      host: "localhost",
      user: os.userInfo().username,
      port: 22,
      type: "local",
      authMethod: "sshKey",
      status: "online",
    },
  ];
}
