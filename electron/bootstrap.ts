import { loadMachines, saveMachines, getDefaultMachines } from "../src/lib/machines";

export function ensureDefaultMachine() {
  const machines = loadMachines();
  const hasLocal = machines.some((m) => m.type === "local" || m.host === "localhost");
  if (!hasLocal) {
    saveMachines([...machines, ...getDefaultMachines()]);
  }
}
