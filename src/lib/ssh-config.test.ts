import { describe, it, expect } from "vitest";
import fs from "fs";
import os from "os";
import path from "path";
import { parseSshConfig, discoverSshConfigMachines } from "./ssh-config";

describe("parseSshConfig", () => {
  it("parses host blocks with hostname/user/port/identityfile", () => {
    const hosts = parseSshConfig(
      [
        "# comment",
        "Host dev",
        "  HostName 192.168.1.10",
        "  User ubuntu",
        "  Port 2222",
        "  IdentityFile ~/.ssh/id_ed25519",
        "",
        "Host nas",
        "  HostName nas.local",
      ].join("\n")
    );
    expect(hosts).toHaveLength(2);
    expect(hosts[0]).toEqual({
      name: "dev",
      host: "192.168.1.10",
      user: "ubuntu",
      port: 2222,
      identityFile: "~/.ssh/id_ed25519",
    });
    expect(hosts[1]).toEqual({ name: "nas", host: "nas.local" });
  });

  it("skips wildcard and negated hosts, expands multiple aliases", () => {
    const hosts = parseSshConfig(
      ["Host *.internal", "  User root", "Host !banned a b", "  User deploy"].join("\n")
    );
    expect(hosts.map((h) => h.name)).toEqual(["a", "b"]);
    expect(hosts[0].user).toBe("deploy");
  });

  it("supports key=value syntax and keeps only the first IdentityFile", () => {
    const hosts = parseSshConfig(
      ["Host=box", "HostName=10.0.0.2", "IdentityFile=~/k1", "IdentityFile=~/k2"].join("\n")
    );
    expect(hosts[0].host).toBe("10.0.0.2");
    expect(hosts[0].identityFile).toBe("~/k1");
  });

  it("ignores global directives outside any Host block", () => {
    const hosts = parseSshConfig(["User globaluser", "Host x", "HostName 1.2.3.4"].join("\n"));
    expect(hosts).toHaveLength(1);
    expect(hosts[0].user).toBeUndefined();
  });
});

describe("discoverSshConfigMachines", () => {
  it("returns [] when ~/.ssh/config does not exist", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "av-sshcfg-"));
    expect(discoverSshConfigMachines(home)).toEqual([]);
  });

  it("maps hosts to auto machines with defaults", () => {
    const home = fs.mkdtempSync(path.join(os.tmpdir(), "av-sshcfg-"));
    fs.mkdirSync(path.join(home, ".ssh"));
    fs.writeFileSync(path.join(home, ".ssh", "config"), "Host dev\n  HostName 192.168.1.10\n");
    const machines = discoverSshConfigMachines(home);
    expect(machines).toHaveLength(1);
    expect(machines[0].id).toBe("sshcfg-dev");
    expect(machines[0].type).toBe("ssh");
    expect(machines[0].port).toBe(22);
    expect(machines[0].auto).toBe(true);
    expect(machines[0].user).toBe(os.userInfo().username);
  });
});
