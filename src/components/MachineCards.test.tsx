// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import MachineCards from "./MachineCards";
import { setLocale } from "@/components/i18n";
import type { MachineConfig } from "@/lib/types";

const machines: MachineConfig[] = [
  { id: "local-1", name: "my-laptop", host: "localhost", user: "me", port: 22, type: "local", authMethod: "sshKey", status: "online" },
  { id: "ssh-1", name: "dev-box", host: "10.0.0.2", user: "dev", port: 22, type: "ssh", authMethod: "sshKey", status: "unknown", auto: true },
];

beforeEach(() => setLocale("en"));

describe("MachineCards", () => {
  it("渲染机器卡片与本机/远程信息", () => {
    render(<MachineCards machines={machines} onSelect={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("my-laptop")).toBeInTheDocument();
    expect(screen.getByText("dev@10.0.0.2:22")).toBeInTheDocument();
    expect(screen.getByText("Local machine")).toBeInTheDocument();
  });

  it("鼠标点击与键盘 Enter 都能选中机器", async () => {
    const onSelect = vi.fn();
    render(<MachineCards machines={machines} onSelect={onSelect} onRemove={vi.fn()} />);
    const card = screen.getByRole("button", { name: /dev-box/ });
    await userEvent.click(card);
    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect.mock.calls[0][0].id).toBe("ssh-1");
    card.focus();
    await userEvent.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledTimes(2);
  });

  it("删除按钮只触发 onRemove，不误触选中", async () => {
    const onSelect = vi.fn();
    const onRemove = vi.fn();
    render(<MachineCards machines={machines} onSelect={onSelect} onRemove={onRemove} />);
    await userEvent.click(screen.getByRole("button", { name: "Remove machine" }));
    expect(onRemove).toHaveBeenCalledWith("ssh-1");
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("空态", () => {
    render(<MachineCards machines={[]} onSelect={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("No Machines")).toBeInTheDocument();
  });

  it("本地化到中文", () => {
    setLocale("zh");
    render(<MachineCards machines={machines} onSelect={vi.fn()} onRemove={vi.fn()} />);
    expect(screen.getByText("本机")).toBeInTheDocument();
    expect(screen.getByText("选择一台机器查看其上的 agent 会话。")).toBeInTheDocument();
  });
});
