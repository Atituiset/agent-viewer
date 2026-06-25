import os from "os";
import type { MachineConfig } from "../src/lib/types";
import { LocalFileSource } from "./fs-source/local";
import { SshFileSource } from "./fs-source/ssh";
import type { FileSource } from "./fs-source/types";

const cache = new Map<string, FileSource>();

/** 根据 machine 配置解析并缓存 FileSource。local → LocalFileSource；ssh → SshFileSource（连接按 id 缓存）。 */
export async function getSource(machine: MachineConfig): Promise<FileSource> {
  const cached = cache.get(machine.id);
  if (cached) return cached;

  let source: FileSource;
  if (machine.type === "local" || machine.host === "localhost") {
    source = new LocalFileSource();
  } else {
    source = new SshFileSource({
      host: machine.host,
      port: machine.port,
      username: machine.user,
      password: machine.password,
      privateKey: machine.sshKey,
    });
    await (source as SshFileSource).init();
  }
  cache.set(machine.id, source);
  return source;
}

export async function disposeSource(machineId: string): Promise<void> {
  const s = cache.get(machineId);
  if (s) {
    try {
      await s.dispose?.();
    } catch {}
    cache.delete(machineId);
  }
}

export async function disposeAll(): Promise<void> {
  for (const id of Array.from(cache.keys())) await disposeSource(id);
}

export function localMachine(): MachineConfig {
  return {
    id: `local-${os.hostname()}`,
    name: os.hostname(),
    host: "localhost",
    user: os.userInfo().username,
    port: 22,
    type: "local",
    authMethod: "sshKey",
    status: "online",
  };
}
