import type { MachineConfig } from "../src/lib/types";
import { TOOLS } from "../src/lib/registry";
import { LocalFileSource } from "./fs-source/local";
import { SshFileSource } from "./fs-source/ssh";
import { listWslHomes, WslFileSource } from "./fs-source/wsl";
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

const multiCache = new Map<string, FileSource[]>();

/**
 * local 机器在 win32 上聚合「Windows home + 所有 WSL distro home」——
 * agent 装在 WSL 里时 session 文件在 \\wsl$\... 下，单扫 Windows home 会漏/归零。
 * WSL home 只保留至少命中一个工具 detectPaths 的，避免空 distro 拖慢 detect。
 */
export async function getSources(machine: MachineConfig): Promise<FileSource[]> {
  const primary = await getSource(machine);
  if (machine.type !== "local" && machine.host !== "localhost") return [primary];

  const cached = multiCache.get(machine.id);
  if (cached) return cached;

  const sources = [primary];
  for (const { home, distro } of await listWslHomes()) {
    const src = new WslFileSource(home, distro);
    try {
      const hit = await Promise.any(
        TOOLS.flatMap((t) =>
          t.detectPaths.map((p) =>
            src.exists(p).then((ok) => {
              if (!ok) throw new Error("no");
              return p;
            })
          )
        )
      ).then(() => true).catch(() => false);
      if (hit) sources.push(src);
    } catch {}
  }
  multiCache.set(machine.id, sources);
  return sources;
}

export async function disposeSource(machineId: string): Promise<void> {
  inflight.delete(machineId);
  multiCache.delete(machineId);
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
