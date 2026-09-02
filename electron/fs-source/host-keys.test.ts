import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { checkHostKey, verifyHostKey } from "./host-keys";

function tmpFile(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "av-hostkeys-"));
  return path.join(dir, "known-hosts.json");
}

describe("checkHostKey", () => {
  it("reports first-seen for unknown hosts", () => {
    expect(checkHostKey({}, "h:22", "aa")).toBe("first-seen");
  });

  it("reports trusted when the fingerprint matches", () => {
    expect(checkHostKey({ "h:22": "aa" }, "h:22", "aa")).toBe("trusted");
  });

  it("reports changed when the fingerprint differs", () => {
    expect(checkHostKey({ "h:22": "aa" }, "h:22", "bb")).toBe("changed");
  });
});

describe("verifyHostKey", () => {
  it("trusts and persists a key on first connection (TOFU)", () => {
    const file = tmpFile();
    expect(verifyHostKey("example.com", 22, "fp-1", file)).toBe(true);
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))["example.com:22"]).toBe("fp-1");
  });

  it("accepts subsequent connections with the same key", () => {
    const file = tmpFile();
    verifyHostKey("example.com", 22, "fp-1", file);
    expect(verifyHostKey("example.com", 22, "fp-1", file)).toBe(true);
  });

  it("rejects a changed key (possible MITM) and does not overwrite the store", () => {
    const file = tmpFile();
    verifyHostKey("example.com", 22, "fp-1", file);
    expect(verifyHostKey("example.com", 22, "fp-evil", file)).toBe(false);
    expect(JSON.parse(fs.readFileSync(file, "utf-8"))["example.com:22"]).toBe("fp-1");
  });

  it("scopes trust per host:port", () => {
    const file = tmpFile();
    verifyHostKey("example.com", 22, "fp-1", file);
    expect(verifyHostKey("example.com", 2222, "fp-2", file)).toBe(true);
    expect(verifyHostKey("other.com", 22, "fp-3", file)).toBe(true);
  });

  it("starts empty when the store file is corrupt", () => {
    const file = tmpFile();
    fs.writeFileSync(file, "not json{");
    expect(verifyHostKey("example.com", 22, "fp-1", file)).toBe(true);
  });
});
