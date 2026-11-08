import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";

// electron 44 在首次 require 时懒下载平台二进制；单测只需要 safeStorage 的 API
// 形状，不应该为了跑 parser/registry 测试去下载 100MB+ 的 Electron。
vi.mock("electron", () => ({
  safeStorage: {
    isEncryptionAvailable: () => false,
    encryptString: () => Buffer.from(""),
    decryptString: () => "",
  },
}));

// vitest 的 globals:false 模式下 RTL 不会自动卸载组件，手动接上。
afterEach(() => cleanup());
