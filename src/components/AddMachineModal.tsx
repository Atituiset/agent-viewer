"use client";

import { useState } from "react";

interface Props {
  onAdd: (machine: { name: string; host: string; user: string; port: number; authMethod: "sshKey" | "password"; sshKey?: string; password?: string }) => void;
  onClose: () => void;
}

export default function AddMachineModal({ onAdd, onClose }: Props) {
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [user, setUser] = useState("");
  const [port, setPort] = useState("22");
  const [authMethod, setAuthMethod] = useState<"sshKey" | "password">("sshKey");
  const [sshKey, setSshKey] = useState("");
  const [password, setPassword] = useState("");

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

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div
        className="bg-zinc-900 border border-zinc-700 rounded-xl p-6 w-full max-w-md"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold text-zinc-200 mb-4">Add Remote Machine</h2>
        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label className="text-xs text-zinc-500 block mb-1">Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="my-server"
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div className="grid grid-cols-3 gap-3">
            <div className="col-span-2">
              <label className="text-xs text-zinc-500 block mb-1">Host</label>
              <input
                type="text"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                placeholder="192.168.1.100"
                required
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Port</label>
              <input
                type="text"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:border-zinc-500"
              />
            </div>
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1">User</label>
            <input
              type="text"
              value={user}
              onChange={(e) => setUser(e.target.value)}
              placeholder="ubuntu"
              required
              className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
            />
          </div>
          <div>
            <label className="text-xs text-zinc-500 block mb-1.5">Authentication Method</label>
            <div className="flex gap-2">
              <button
                type="button"
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
              <label className="text-xs text-zinc-500 block mb-1">SSH Key Path</label>
              <input
                type="text"
                value={sshKey}
                onChange={(e) => setSshKey(e.target.value)}
                placeholder="~/.ssh/id_rsa"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
          ) : (
            <div>
              <label className="text-xs text-zinc-500 block mb-1">Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Enter password"
                className="w-full bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 placeholder-zinc-600 focus:outline-none focus:border-zinc-500"
              />
            </div>
          )}
          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-sm text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-4 py-2 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded-lg transition-colors"
            >
              Add Machine
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
