import { TOOLS } from "../src/lib/registry";
import { isAutoHidden } from "../src/lib/machines";
import type { MachineConfig } from "../src/lib/types";
import { listWslHomes, WslFileSource, type WslHome } from "./fs-source/wsl";

// 发现要起 wsl.exe 子进程 + UNC readdir + detectPaths 探测，进不了 5s 的 machines 热路径缓存。
const WSL_CACHE_MS = 60_000;
let cache: { at: number; value: MachineConfig[] } | null = null;

export function invalidateWslMachinesCache() {
  cache = null;
}

/** home 的最后一段即 Linux 用户名（\\wsl$<distro>\home\<user>；测试注入 posix 路径亦可）。 */
export function wslMachineFor({ home, distro }: WslHome): MachineConfig {
  const user = home.split(/[\\/]+/).filter(Boolean).pop() ?? "user";
  return {
    id: `wsl-${distro}-${user}`,
    name: distro,
    host: home, // 解析好的 UNC home，source 直接用它，不再重探测 wsl$/wsl.localhost 前缀
    user,
    port: 22,
    type: "wsl",
    authMethod: "sshKey",
    distro,
    auto: true,
    status: "online",
  };
}

/** 只保留至少命中一个工具 detectPaths 的 home（空 distro 不值得占一张卡片）。 */
export async function probeWslHomes(homes: WslHome[]): Promise<MachineConfig[]> {
  const paths = TOOLS.flatMap((t) => t.detectPaths);
  const machines: MachineConfig[] = [];
  for (const h of homes) {
    const src = new WslFileSource(h.home, h.distro);
    try {
      const present = src.existsBatch
        ? await src.existsBatch(paths).catch(() => paths.map(() => false))
        : await Promise.all(paths.map((p) => src.exists(p).catch(() => false)));
      if (present.some(Boolean)) machines.push(wslMachineFor(h));
    } catch {}
  }
  return machines;
}

/**
 * 自动发现有 agent 数据的 WSL distro，作为独立机器卡片（走 wsl.exe/UNC，不用 SSH，
 * 规避 WSL2 IP 漂移）。仅 win32 有意义；homes 参数仅供测试注入。
 */
export async function discoverWslMachines(homes?: WslHome[]): Promise<MachineConfig[]> {
  if (process.platform !== "win32" && !homes) return [];
  if (!homes) {
    const now = Date.now();
    if (cache && now - cache.at < WSL_CACHE_MS) return cache.value;
    const value = (await probeWslHomes(await listWslHomes())).filter((m) => !isAutoHidden(m.id));
    cache = { at: now, value };
    return value;
  }
  return (await probeWslHomes(homes)).filter((m) => !isAutoHidden(m.id));
}
