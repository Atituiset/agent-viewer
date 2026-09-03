import { describe, it, expect } from "vitest";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { withSqliteDb } from "./sqlite";
import { FakeFileSource } from "./fs-source/fake";
import { LocalFileSource } from "./fs-source/local";

/** 实现了远端直查能力的 fake source（模拟 WSL/SSH）。 */
class QueryableFake extends FakeFileSource {
  bufferReads = 0;
  shouldFailTransport = false;

  async querySqlite(): Promise<Record<string, unknown>[]> {
    if (this.shouldFailTransport) throw new Error("no python3 on remote");
    return [{ id: "1" }];
  }

  async readFileBuffer(p: string): Promise<Buffer> {
    this.bufferReads++;
    return super.readFileBuffer(p);
  }
}

function realDbBuffer(): Buffer {
  const p = path.join(os.tmpdir(), `av_src_${Math.random().toString(36).slice(2)}.db`);
  const db = new Database(p);
  db.exec("CREATE TABLE t(id TEXT)");
  db.prepare("INSERT INTO t VALUES (?)").run("ok");
  db.close();
  const buf = fs.readFileSync(p);
  fs.unlinkSync(p);
  return buf;
}

describe("withSqliteDb 回退语义", () => {
  it("回调里的数据/解析错误直接冒泡，不触发整库拷贝", async () => {
    const src = new QueryableFake();
    await expect(
      withSqliteDb(src, "x.db", async () => {
        throw new Error("bad data");
      })
    ).rejects.toThrow("bad data");
    expect(src.bufferReads).toBe(0);
  });

  it("传输失败（远端无 python3）回退整库拷贝，拷贝路径可查", async () => {
    const src = new QueryableFake();
    src.shouldFailTransport = true;
    src.add("x.db", realDbBuffer());
    const rows = await withSqliteDb(src, "x.db", async (db) => db.prepare("SELECT id FROM t").all());
    expect(rows).toEqual([{ id: "ok" }]);
    expect(src.bufferReads).toBe(1);
  });

  it("本地直开路径：回调数据错误也不回退", async () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "av-sqlite-"));
    const p = path.join(home, "real.db");
    const db = new Database(p);
    db.exec("CREATE TABLE t(id TEXT)");
    db.close();
    const src = new LocalFileSource(home);
    await expect(
      withSqliteDb(src, "real.db", async () => {
        throw new Error("bad data");
      })
    ).rejects.toThrow("bad data");
  });
});
