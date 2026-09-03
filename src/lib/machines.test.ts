import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { loadMachines, saveMachines, addMachine, removeMachine } from "./machines";

function freshDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "av-machines-"));
  process.env.AGENT_VIEWER_CONFIG_DIR = dir;
  return dir;
}

const sshCfg = { host: "srv.local", user: "dev", port: 22, type: "ssh" as const, authMethod: "sshKey" as const };

beforeEach(() => {
  freshDir();
});

describe("machines persistence", () => {
  it("首次加载生成默认本机条目并落盘", () => {
    const dir = process.env.AGENT_VIEWER_CONFIG_DIR!;
    const machines = loadMachines();
    const local = machines.find((m) => m.type === "local");
    expect(local).toBeDefined();
    expect(fs.existsSync(path.join(dir, "machines.json"))).toBe(true);
  });

  it("addMachine 持久化并能原样读回（含密码字段的往返）", () => {
    addMachine({ name: "srv", ...sshCfg, password: "s3cret" });
    const again = loadMachines();
    const m = again.find((x) => x.host === "srv.local");
    expect(m).toBeDefined();
    // 测试环境无 keychain，protectSecret 走明文路径；关键是往返一致而不是丢字段。
    expect(m!.password).toBe("s3cret");
  });

  it("相同 host:port 重复添加时生成不冲突的 id", () => {
    const a = addMachine({ name: "a", ...sshCfg });
    const b = addMachine({ name: "b", ...sshCfg });
    expect(a.id).not.toBe(b.id);
  });

  it("saveMachines 不落盘 auto 机器", () => {
    const dir = process.env.AGENT_VIEWER_CONFIG_DIR!;
    saveMachines([
      { id: "auto-1", name: "a", ...sshCfg, status: "unknown", auto: true },
      { id: "m-1", name: "b", ...sshCfg, status: "unknown" },
    ]);
    const onDisk = JSON.parse(fs.readFileSync(path.join(dir, "machines.json"), "utf-8"));
    expect(onDisk.map((m: { id: string }) => m.id)).toEqual(["m-1"]);
  });

  it("removeMachine 移除持久机器；对 auto 机器记 tombstone", () => {
    const dir = process.env.AGENT_VIEWER_CONFIG_DIR!;
    // 预置一台普通机器 + 一台 auto 机器（auto 由 ~/.ssh/config 发现的语义等价物）
    fs.writeFileSync(
      path.join(dir, "machines.json"),
      JSON.stringify([
        { id: "keep", name: "k", ...sshCfg, status: "unknown" },
        { id: "auto-xyz", name: "a", ...sshCfg, status: "unknown", auto: true },
      ])
    );
    removeMachine("auto-xyz");
    const hidden = JSON.parse(fs.readFileSync(path.join(dir, "ssh-config-hidden.json"), "utf-8"));
    expect(hidden).toContain("auto-xyz");
    const after = loadMachines();
    expect(after.some((m) => m.id === "keep")).toBe(true);
    expect(after.some((m) => m.id === "auto-xyz")).toBe(false);
  });

  it("machines.json 损坏时回退默认本机，不抛异常", () => {
    const dir = process.env.AGENT_VIEWER_CONFIG_DIR!;
    fs.writeFileSync(path.join(dir, "machines.json"), "{broken");
    const machines = loadMachines();
    expect(machines.some((m) => m.type === "local")).toBe(true);
  });
});
