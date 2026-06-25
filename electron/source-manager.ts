import type { MachineConfig } from "../src/lib/types";
import { LocalFileSource } from "./fs-source/local";
import { SshFileSource } from "./fs-source/ssh";
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
    if (machine.type === "local" || machine.host === "localhost") {
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
