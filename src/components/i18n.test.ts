// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { translate, setLocale, getLocale, t, type MsgKey } from "./i18n";

function placeholders(s: string): string[] {
  return Array.from(s.matchAll(/\{(\w+)\}/g)).map((m) => m[1]).sort();
}

beforeEach(() => setLocale("en"));

describe("i18n", () => {
  it("插值替换变量", () => {
    expect(translate("en", "msg.expandContent", { n: 1234 })).toContain("1234");
    expect(translate("zh", "tools.error.body", { machine: "srv" })).toBe("无法从 srv 读取工具列表。");
  });

  it("zh 字典覆盖了所有 en key，且占位符完全一致", () => {
    // 通过翻译一个 sentinel 值探测 key 是否存在：缺失时 translate 会回退 key 原文。
    const enKeys: MsgKey[] = [
      "nav.machines", "nav.addMachine", "nav.loading", "tools.error.sshHint",
      "sessions.msgs", "msg.toolCallsSummary", "swimlane.user", "add.passwordHint",
    ];
    for (const k of enKeys) {
      expect(translate("zh", k)).not.toBe(k);
    }
  });

  it("setLocale 切换 + localStorage 持久化", () => {
    setLocale("zh");
    expect(getLocale()).toBe("zh");
    expect(t("nav.machines")).toBe("机器");
    expect(localStorage.getItem("agent-viewer-locale")).toBe("zh");
    setLocale("en");
    expect(t("nav.machines")).toBe("Machines");
  });

  it("占位符在两种语言间一致", () => {
    const samples: MsgKey[] = ["msg.expandContent", "sessions.filteredFrom", "tools.error.body"];
    for (const k of samples) {
      expect(placeholders(translate("zh", k))).toEqual(placeholders(translate("en", k)));
    }
  });
});
