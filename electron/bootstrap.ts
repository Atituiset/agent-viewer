import { loadMachines } from "../src/lib/machines";

export function ensureDefaultMachine() {
  // loadMachines 在 machines.json 不存在时会自动写入默认本机配置；
  // 文件已存在则只读取，不会把用户在 UI 删除的本机重新加回。
  loadMachines();
}
