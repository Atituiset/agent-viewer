// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import AddMachineModal from "./AddMachineModal";
import { setLocale } from "@/components/i18n";

beforeEach(() => setLocale("en"));

describe("AddMachineModal", () => {
  const base = { onAdd: vi.fn(), onClose: vi.fn() };

  it("必填校验：缺 host/user 不提交", async () => {
    const onAdd = vi.fn();
    render(<AddMachineModal {...base} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole("button", { name: "Add Machine" }));
    expect(onAdd).not.toHaveBeenCalled();
  });

  it("提交汇总表单字段（默认 sshKey 认证，端口缺省 22）", async () => {
    const onAdd = vi.fn();
    render(<AddMachineModal {...base} onAdd={onAdd} />);
    await userEvent.type(screen.getByLabelText("Host"), "10.0.0.9");
    await userEvent.type(screen.getByLabelText("User"), "ubuntu");
    await userEvent.click(screen.getByRole("button", { name: "Add Machine" }));
    expect(onAdd).toHaveBeenCalledWith(
      expect.objectContaining({ host: "10.0.0.9", user: "ubuntu", port: 22, authMethod: "sshKey" })
    );
  });

  it("切到密码认证时带密码提交并展示落盘提示", async () => {
    const onAdd = vi.fn();
    render(<AddMachineModal {...base} onAdd={onAdd} />);
    await userEvent.click(screen.getByRole("radio", { name: "Password" }));
    expect(screen.getByText(/OS keychain/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText("Host"), "10.0.0.9");
    await userEvent.type(screen.getByLabelText("User"), "ubuntu");
    await userEvent.type(screen.getByLabelText("Password"), "pw");
    await userEvent.click(screen.getByRole("button", { name: "Add Machine" }));
    expect(onAdd).toHaveBeenCalledWith(expect.objectContaining({ authMethod: "password", password: "pw" }));
  });

  it("Esc 关闭弹窗", async () => {
    const onClose = vi.fn();
    render(<AddMachineModal {...base} onClose={onClose} />);
    await userEvent.keyboard("{Escape}");
    expect(onClose).toHaveBeenCalled();
  });

  it("错误以 role=alert 展示", () => {
    render(<AddMachineModal {...base} error="invalid machine config" />);
    expect(screen.getByRole("alert")).toHaveTextContent("invalid machine config");
  });

  it("aria 属性：dialog/modal/labelledby", () => {
    render(<AddMachineModal {...base} />);
    const dialog = screen.getByRole("dialog");
    expect(dialog).toHaveAttribute("aria-modal", "true");
    expect(dialog).toHaveAttribute("aria-labelledby", "add-machine-title");
  });
});
