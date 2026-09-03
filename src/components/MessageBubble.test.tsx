// @vitest-environment jsdom
import { describe, it, expect, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MessageBubble from "./MessageBubble";
import { setLocale } from "@/components/i18n";
import type { ConversationMessage } from "@/lib/types";

beforeEach(() => setLocale("en"));

const base: ConversationMessage = {
  id: "m1",
  role: "assistant",
  content: "hello world",
  timestamp: "2026-09-01T10:00:00.000Z",
  source: "claude",
};

describe("MessageBubble", () => {
  it("渲染角色徽标与内容", () => {
    render(<MessageBubble message={base} />);
    expect(screen.getByText("Claude")).toBeInTheDocument();
    expect(screen.getByText("hello world")).toBeInTheDocument();
  });

  it("compact 模式合并 toolCalls 为一行摘要", () => {
    const msg: ConversationMessage = {
      ...base,
      toolCalls: [
        { name: "Bash", input: {} },
        { name: "Bash", input: {} },
        { name: "Read", input: {} },
      ],
    };
    render(<MessageBubble message={msg} compact />);
    expect(screen.getByText(/3 calls: Bash ×2, Read/)).toBeInTheDocument();
  });

  it("长内容 compact 模式可展开/收起", async () => {
    const msg: ConversationMessage = { ...base, content: "x".repeat(2000) };
    render(<MessageBubble message={msg} compact />);
    const expand = screen.getByRole("button", { name: /Show all/ });
    await userEvent.click(expand);
    expect(screen.getByRole("button", { name: /Collapse/ })).toBeInTheDocument();
  });

  it("中文界面渲染 次数计数文案", () => {
    setLocale("zh");
    const msg: ConversationMessage = { ...base, toolCalls: [{ name: "Bash", input: {} }] };
    render(<MessageBubble message={msg} compact />);
    expect(screen.getByText(/1 次调用: Bash/)).toBeInTheDocument();
  });
});
