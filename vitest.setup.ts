import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

// vitest 的 globals:false 模式下 RTL 不会自动卸载组件，手动接上。
afterEach(() => cleanup());
