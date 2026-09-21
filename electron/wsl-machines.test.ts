import { describe, it, expect, beforeEach } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { wslMachineFor, probeWslHomes, discoverWslMachines } from "./wsl-machines";
import { removeMachine } from "../src/lib/machines";

beforeEach(() => {
  process.env.AGENT_VIEWER_CONFIG_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "av-wsl-machines-"));
});

function fakeHomeWithAgent(distro: string): { home: string; distro: string } {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), `av-wsl-home-${distro}-`));
  fs.mkdirSync(path.join(home, ".claude", "projects"), { recursive: true });
  return { home, distro };
}

describe("wslMachineFor", () => {
  it("从 UNC home 解析用户名并构造 auto 机器", () => {
    const m = wslMachineFor({ home: "\\\\wsl$\\Ubuntu\\home\\alice", distro: "Ubuntu" });
    expect(m).toMatchObject({
      id: "wsl-Ubuntu-alice",
      name: "Ubuntu",
      host: "\\\\wsl$\\Ubuntu\\home\\alice",
      user: "alice",
      type: "wsl",
      distro: "Ubuntu",
      auto: true,
      status: "online",
    });
  });
});

describe("probeWslHomes", () => {
  it("只保留命中 detectPaths 的 home", async () => {
    const withAgent = fakeHomeWithAgent("Ubuntu");
    const empty = { home: fs.mkdtempSync(path.join(os.tmpdir(), "av-wsl-home-empty-")), distro: "docker-desktop" };
    const machines = await probeWslHomes([withAgent, empty]);
    expect(machines.map((m) => m.distro)).toEqual(["Ubuntu"]);
  });
});

describe("discoverWslMachines", () => {
  it("非 win32 且无注入 homes 时返回空", async () => {
    if (process.platform === "win32") return;
    expect(await discoverWslMachines()).toEqual([]);
  });

  it("被 removeMachine 删掉的 WSL 机器不再出现（tombstone）", async () => {
    const home = fakeHomeWithAgent("Ubuntu");
    const before = await discoverWslMachines([home]);
    expect(before).toHaveLength(1);
    removeMachine(before[0].id);
    expect(await discoverWslMachines([home])).toEqual([]);
  });
});
