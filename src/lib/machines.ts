import fs from "fs";
import path from "path";
import os from "os";
import type { MachineConfig } from "./types";

const CONFIG_DIR = path.join(os.homedir(), ".config", "agent-viewer");
const MACHINES_FILE = path.join(CONFIG_DIR, "machines.json");

function ensureConfigDir() {
  if (!fs.existsSync(CONFIG_DIR)) {
    fs.mkdirSync(CONFIG_DIR, { recursive: true });
  }
}

export function loadMachines(): MachineConfig[] {
  ensureConfigDir();
  if (!fs.existsSync(MACHINES_FILE)) {
    const defaults = getDefaultMachines();
    saveMachines(defaults);
    return defaults;
  }
  try {
    const data = JSON.parse(fs.readFileSync(MACHINES_FILE, "utf-8"));
    return data as MachineConfig[];
  } catch {
    return getDefaultMachines();
  }
}

export function saveMachines(machines: MachineConfig[]) {
  ensureConfigDir();
  fs.writeFileSync(MACHINES_FILE, JSON.stringify(machines, null, 2));
}

export function addMachine(machine: Omit<MachineConfig, "id" | "status">): MachineConfig {

  const machines = loadMachines();
  const id = `ssh-${machine.host}-${machine.port}`;
  const newMachine: MachineConfig = {
    ...machine,
    id,
    status: "unknown",
  };
  machines.push(newMachine);
  saveMachines(machines);
  return newMachine;
}

export function removeMachine(id: string) {
  const machines = loadMachines().filter((m) => m.id !== id);
  saveMachines(machines);
}

export function getDefaultMachines(): MachineConfig[] {
  return [
    {
      id: `local-${os.hostname()}`,
      name: os.hostname(),
      host: "localhost",
      user: os.userInfo().username,
      port: 22,
      type: "local",
      authMethod: "sshKey",
      status: "online",
    },
  ];
}
