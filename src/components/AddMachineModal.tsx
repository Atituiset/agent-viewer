"use client";

import { useEffect, useRef, useState } from "react";
import { useT } from "@/components/i18n";

interface Props {
  /** 添加失败时显示的错误（保持弹窗打开）。 */
  error?: string | null;
  onAdd: (machine: { name: string; host: string; user: string; port: number; authMethod: "sshKey" | "password"; sshKey?: string; password?: string }) => void;
  onClose: () => void;
}

export default function AddMachineModal({ error, onAdd, onClose }: Props) {
  const t = useT();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("22");
  const [authMethod, setAuthMethod] = useState<"sshKey" | "password">("sshKey");
  const [sshKey, setSshKey] = useState("");
  const [password, setPassword] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  // a11y: 打开时聚焦第一个输入框；Esc 关闭；关闭后焦点归还给触发者。
  useEffect(() => {
    const prevActive = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    dialogRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      prevActive?.focus();
    };
  }, [onClose]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!host || !user) return;
    onAdd({
      name: name || host,
      host,
      user,
      port: parseInt(port) || 22,
      authMethod,
      sshKey: authMethod === "sshKey" && sshKey ? sshKey : undefined,
      password: authMethod === "password" && password ? password : undefined,
    });
  };

  const field =
    "w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500";
  const labelCls = "text-xs text-zinc-500 block mb-1";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="add-machine-title"
        className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 id="add-machine-title" className="text-lg font-semibold text-zinc-200 mb-4">
          {t("add.title")}
        </h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="am-name" className={labelCls}>{t("add.name")}</label>
            <input
              id="am-name"
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-server"
              className={field}
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label htmlFor="am-host" className={labelCls}>{t("add.host")}</label>
              <input
                id="am-host"
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.100"
                required
                className={field}
              />
            </div>
            <div>
              <label htmlFor="am-port" className={labelCls}>{t("add.port")}</label>
              <input
                id="am-port"
                type="text"
                inputMode="numeric"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className={field}
              />
            </div>
          </div>
          <div>
            <label htmlFor="am-user" className={labelCls}>{t("add.user")}</label>
            <input
              id="am-user"
              type="text"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="ubuntu"
              required
              className={field}
            />
          </div>
          <div>
            <span className={`${labelCls} mb-1.5`}>{t("add.auth")}</span>
            <div className="flex gap-2" role="radiogroup" aria-label={t("add.auth")}>
              <button
                type="button"
                role="radio"
                aria-checked={authMethod === "sshKey"}
                onClick={() => setAuthMethod("sshKey")}
                className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-colors ${
                  authMethod === "sshKey"
                    ? "border-blue-500 bg-blue-500/10 text-blue-400"
                    : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                SSH Key
              </button>
              <button
                type="button"
                role="radio"
                aria-checked={authMethod === "password"}
                onClick={() => setAuthMethod("password")}
                className={`flex-1 px-3 py-2 text-xs rounded-lg border transition-colors ${
                  authMethod === "password"
                    ? "border-blue-500 bg-blue-500/10 text-blue-400"
                    : "border-zinc-700 bg-zinc-800 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                Password
              </button>
            </div>
          </div>
          {authMethod === "sshKey" ? (
            <div>
              <label htmlFor="am-sshkey" className={labelCls}>{t("add.keyPath")}</label>
              <input
                id="am-sshkey"
                type="text"
                value={sshKey}
                onChange={(e) => setSshKey(e.target.value)}
                placeholder="~/.ssh/id_rsa"
                className={field}
              />
            </div>
          ) : (
            <div>
              <label htmlFor="am-password" className={labelCls}>{t("add.password")}</label>
              <input
                id="am-password"
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={t("add.passwordPlaceholder")}
                className={field}
              />
              <p className="text-[11px] text-zinc-600 mt-1">{t("add.passwordHint")}</p>
            </div>
          )}
          {error && (
            <div role="alert" className="px-3 py-2 rounded-lg border border-red-800/60 bg-red-900/20 text-red-300 text-xs break-words">
              {error}
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {t("add.cancel")}
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
            >
              {t("add.submit")}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
