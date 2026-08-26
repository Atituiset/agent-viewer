import fs from "fs";
import os from "os";
import path from "path";
import type { FileSource } from "./fs-source/types";

type SqliteDatabase = import("better-sqlite3").Database;

/** 惰性加载原生绑定：WSL 查询路径用不到它（Windows 进程也加载不了 Linux 构建的 .node）。 */
async function loadDatabase(): Promise<typeof import("better-sqlite3")> {
  return (await import("better-sqlite3")).default;
}

/**
 * 解析器见到的最小 sqlite 接口。本地直开/整库拷贝用 better-sqlite3 同步实现，
 * WSL source 用 wsl.exe + python3 远程查询实现，统一成异步。
 */
export interface DbLike {
  prepare(sql: string): { all(...params: unknown[]): Promise<Record<string, unknown>[]> };
}

function wrapDb(db: SqliteDatabase): DbLike {
  return {
    prepare: (sql) => ({
      all: async (...params) => db.prepare(sql).all(...params) as Record<string, unknown>[],
    }),
  };
}

/** 把 db 字节写入临时文件并打开，返回 {db, cleanup}。调用方负责 cleanup()。
 *  注：必须以可写方式打开，否则 `journal_mode = WAL` 会因 "attempt to write a readonly database" 失败。
 *  temp 文件由本函数独占持有并在 cleanup 中删除，故可写是安全的。 */
export async function openDbFromBuffer(buf: Buffer): Promise<{ db: SqliteDatabase; cleanup: () => void }> {
  const Database = await loadDatabase();
  const tmpPath = path.join(os.tmpdir(), `av_opencode_${process.pid}_${Math.random().toString(36).slice(2)}.db`);
  fs.writeFileSync(tmpPath, buf);
  const db = new Database(tmpPath);
  db.pragma("journal_mode = WAL");
  db.pragma("wal_checkpoint(TRUNCATE)");
  const cleanup = () => {
    try { db.close(); } catch {}
    for (const suffix of ["", "-wal", "-shm"]) {
      try { fs.unlinkSync(tmpPath + suffix); } catch {}
    }
  };
  return { db, cleanup };
}

/**
 * 能「在文件所在机器上直接查 sqlite」的 source 实现此能力：
 * WSL 走 wsl.exe + python3，SSH 走 exec + python3（见各 source 实现注释）。
 */
export interface SqliteQueryable {
  querySqlite(rel: string, sql: string, params?: unknown[]): Promise<Record<string, unknown>[]>;
}

function asQueryable(source: FileSource): (FileSource & SqliteQueryable) | null {
  return typeof (source as unknown as SqliteQueryable).querySqlite === "function"
    ? (source as FileSource & SqliteQueryable)
    : null;
}

/**
 * 打开 source 上的 sqlite 并回调，按 source 能力选路径：
 * - 实现了 querySqlite 的 source（WSL/SSH）：远端直接查——UNC 9p 上 SQLite 直开必败，
 *   GB 级 db 整库拷贝也不可行；
 * - 其他本地 source：直接只读打开原文件；
 * - 以上都不行：回退整库拷贝（小 db 没问题）。
 */
export async function withSqliteDb<T>(
  source: FileSource,
  rel: string,
  fn: (db: DbLike) => T | Promise<T>
): Promise<T> {
  const queryable = asQueryable(source);
  if (queryable) {
    try {
      return await fn({
        prepare: (sql) => ({ all: (...params) => queryable.querySqlite(rel, sql, params) }),
      });
    } catch {
      // 远端查询失败（如无 python3）：落回整库拷贝。
    }
  }
  const local = source.localPath?.(rel);
  if (local) {
    try {
      const Database = await loadDatabase();
      const db = new Database(local, { readonly: true, fileMustExist: true });
      try {
        return await fn(wrapDb(db));
      } finally {
        try { db.close(); } catch {}
      }
    } catch {
      // 直开失败（如 WAL 恢复需要写权限）：落回整库拷贝。
    }
  }
  const buf = await source.readFileBuffer(rel);
  const { db, cleanup } = await openDbFromBuffer(buf);
  try {
    return await fn(wrapDb(db));
  } finally {
    cleanup();
  }
}
