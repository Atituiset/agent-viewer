import type { MachineConfig } from "../src/lib/types";
import { LocalFileSource } from "./fs-source/local";
import { SshFileSource } from "./fs-source/ssh";
import { WslFileSource } from "./fs-source/wsl";
import type { FileSource } from "./fs-source/types";

const cache = new Map<string, FileSource>();
const inflight = new Map<string, Promise<FileSource>>();

/** 根据 machine 配置解析并缓存 FileSource。并发首次调用同一 machine 共享一次连接建立。 */
export function getSource(machine: MachineConfig): Promise<FileSource> {
  const cached = cache.get(machine.id);
  if (cached) return Promise.resolve(cached);
  const existing = inflight.get(machine.id);
  if (existing) return existing;

  const p = (async (): Promise<FileSource> => {
    let source: FileSource;
    if (machine.type === "wsl") {
      // host 存的是发现阶段解析好的 UNC home（见 wsl-machines.ts）。
      source = new WslFileSource(machine.host, machine.distro ?? "");
    } else if (machine.type === "local" || machine.host === "localhost") {
      source = new LocalFileSource();
    } else {
      const ssh = new SshFileSource({
        host: machine.host,
        port: machine.port,
        username: machine.user,
        password: machine.password,
        privateKey: machine.sshKey,
      });
      await ssh.init();
      source = ssh;
    }
    cache.set(machine.id, source);
    inflight.delete(machine.id);
    return source;
  })().catch((e) => {
    inflight.delete(machine.id);
    throw e;
  });

  inflight.set(machine.id, p);
  return p;
}

/**
 * 每台机器一个 source。WSL distro 不再并入本机——它们由 wsl-machines.ts
 * 自动发现为独立的 wsl 机器（卡片上 Windows 与 WSL 数据各自分开）。
 */
export async function getSources(machine: MachineConfig): Promise<FileSource[]> {
  return [await getSource(machine)];
}

export async function disposeSource(machineId: string): Promise<void> {
  inflight.delete(machineId);
  const s = cache.get(machineId);
  if (s) {
    try {
      await s.dispose?.();
    } catch {}
    cache.delete(machineId);
  }
}

export async function disposeAll(): Promise<void> {
  for (const id of Array.from(inflight.keys())) inflight.delete(id);
  for (const id of Array.from(cache.keys())) await disposeSource(id);
}
