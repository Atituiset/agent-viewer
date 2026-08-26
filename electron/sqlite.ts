import fs from "fs";
import os from "os";
import path from "path";
import Database from "better-sqlite3";

/** 把 db 字节写入临时文件并打开，返回 {db, cleanup}。调用方负责 cleanup()。
 *  注：必须以可写方式打开，否则 `journal_mode = WAL` 会因 "attempt to write a readonly database" 失败。
 *  temp 文件由本函数独占持有并在 cleanup 中删除，故可写是安全的。 */
export function openDbFromBuffer(buf: Buffer): { db: Database.Database; cleanup: () => void } {
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
