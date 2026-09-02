import fs from "fs";
import os from "os";
import path from "path";

// 与 src/lib/machines.ts 同一约定：~/.config/agent-viewer/
const HOST_KEYS_FILE = path.join(os.homedir(), ".config", "agent-viewer", "known-hosts.json");

const IDEMPOTENT = "known-hosts.json";

type HostKeyStore = Record<string, string>;

function loadStore(file: string): HostKeyStore {
  try {
    const data = JSON.parse(fs.readFileSync(file, "utf-8"));
    if (!data || typeof data !== "object" || Array.isArray(data)) return {};
    return data as HostKeyStore;
  } catch {
    return {};
  }
}

function saveStore(file: string, store: HostKeyStore) {
  const tmp = `${file}.tmp-${process.pid}`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2), { mode: 0o600 });
  fs.renameSync(tmp, file);
}

export type HostKeyResult = "trusted" | "first-seen" | "changed";

export function checkHostKey(store: HostKeyStore, keyId: string, keyHash: string): HostKeyResult {
  const prev = store[keyId];
  if (prev === keyHash) return "trusted";
  if (prev) return "changed";
  return "first-seen";
}

/**
 * SSH 主机密钥校验（TOFU, Trust On First Use）：
 * - 首次连接某 host:port：记录其主机密钥指纹并放行。
 * - 指纹与记录一致：放行。
 * - 指纹变化：拒绝连接（可能是主机重装，也可能是 MITM），
 *   错误会冒泡到 UI，删除 known-hosts.json 中对应条目可重新信任。
 *
 * 不如 OpenSSH 的 known_hosts 交互式确认严格，但远好于 ssh2 默认的全盘接受。
 */
export function verifyHostKey(
  host: string,
  port: number,
  keyHash: string,
  file: string = HOST_KEYS_FILE
): boolean {
  const store = loadStore(file);
  const result = checkHostKey(store, `${host}:${port}`, keyHash);
  if (result === "changed") {
    console.error(
      `[ssh] HOST KEY CHANGED for ${host}:${port} — refusing connection. ` +
        `If this is expected (reinstalled host), remove its entry in ${IDEMPOTENT}.`
    );
    return false;
  }
  if (result === "first-seen") {
    store[`${host}:${port}`] = keyHash;
    saveStore(file, store);
  }
  return true;
}
