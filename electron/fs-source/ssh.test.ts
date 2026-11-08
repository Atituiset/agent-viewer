import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { resolvePrivateKey, ConcurrencyLimiter } from "./ssh";

function tmpHome(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), "av-ssh-"));
}

describe("resolvePrivateKey", () => {
  it("treats the configured value as a path and reads the file", () => {
    const home = tmpHome();
    const keyPath = path.join(home, "mykey");
    fs.writeFileSync(keyPath, "KEY-DATA");
    expect(resolvePrivateKey(keyPath, home)?.toString()).toBe("KEY-DATA");
  });

  it("expands ~ against the given home", () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, ".ssh"));
    fs.writeFileSync(path.join(home, ".ssh", "id_rsa"), "HOME-KEY");
    expect(resolvePrivateKey("~/.ssh/id_rsa", home)?.toString()).toBe("HOME-KEY");
  });

  it("falls back to inline key content when the path does not exist", () => {
    const home = tmpHome();
    expect(resolvePrivateKey("-----BEGIN KEY-----xyz", home)?.toString()).toBe("-----BEGIN KEY-----xyz");
  });

  it("uses default identity files when nothing is configured", () => {
    const home = tmpHome();
    fs.mkdirSync(path.join(home, ".ssh"));
    fs.writeFileSync(path.join(home, ".ssh", "id_ed25519"), "DEFAULT-KEY");
    expect(resolvePrivateKey(undefined, home)?.toString()).toBe("DEFAULT-KEY");
  });

  it("returns undefined when no key is available", () => {
    expect(resolvePrivateKey(undefined, tmpHome())).toBeUndefined();
  });
});

describe("ConcurrencyLimiter", () => {
  it("never runs more than the configured number of jobs", async () => {
    const limiter = new ConcurrencyLimiter(2);
    let active = 0;
    let peak = 0;
    const jobs = Array.from({ length: 10 }, () =>
      limiter.run(async () => {
        active++;
        peak = Math.max(peak, active);
        await new Promise((r) => setTimeout(r, 2));
        active--;
      })
    );
    await Promise.all(jobs);
    expect(peak).toBe(2);
  });

  it("releases the slot when a job throws", async () => {
    const limiter = new ConcurrencyLimiter(1);
    await expect(limiter.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(limiter.run(async () => "ok")).resolves.toBe("ok");
  });
});
