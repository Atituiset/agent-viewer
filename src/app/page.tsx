"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MachineConfig, DetectedTool, ConversationMessage, ToolSession } from "@/lib/types";
import MachineCards from "@/components/MachineCards";
import ToolCards from "@/components/ToolCards";
import SessionList from "@/components/SessionList";
import ConversationView from "@/components/ConversationView";
import AddMachineModal from "@/components/AddMachineModal";

type View = "machines" | "tools" | "sessions" | "conversation";

export default function Home() {
  const [view, setView] = useState<View>("machines");
  const [machines, setMachines] = useState<MachineConfig[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<MachineConfig | null>(null);
  const [tools, setTools] = useState<DetectedTool[]>([]);
  const [selectedTool, setSelectedTool] = useState<DetectedTool | null>(null);
  const [sessions, setSessions] = useState<ToolSession[]>([]);
  const [selectedSession, setSelectedSession] = useState<ToolSession | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [showAddMachine, setShowAddMachine] = useState(false);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    fetch("/api/machines")
      .then((r) => r.json())
      .then((data) => { if (data.machines) setMachines(data.machines); })
      .catch(() => {});
  }, []);

  const loadTools = useCallback(async (machine: MachineConfig) => {
    setSelectedMachine(machine);
    setLoading(true);
    try {
      const res = await fetch("/api/tools?machineId=" + machine.id);
      const data = await res.json();
      setTools(data.tools || []);
      setView("tools");
    } catch {}
    setLoading(false);
  }, []);

  const loadSessions = useCallback(async (tool: DetectedTool) => {
    setSelectedTool(tool);
    setLoading(true);
    try {
      const res = await fetch(`/api/${tool.id}/sessions`);
      const data = await res.json();
      setSessions(data.sessions || []);
      setView("sessions");
    } catch {}
    setLoading(false);
  }, []);

  const loadSession = useCallback(async (session: ToolSession) => {
    if (!selectedTool) return;
    setSelectedSession(session);
    setLoading(true);
    setMessages([]);
    try {
      const toolId = selectedTool.id;
      let url = `/api/${toolId}/session?id=${session.id}`;
      if (toolId === "claude-code" && session.projectPath) {
        url += `&projectPath=${encodeURIComponent(session.projectPath)}`;
      }
      const data = await fetch(url).then((r) => r.json());
      setMessages(data.messages || []);
      setView("conversation");
    } catch (e) {
      console.error("Failed to load session:", e);
    }
    setLoading(false);
  }, [selectedTool]);

  const refreshSession = useCallback(async () => {
    if (!selectedSession || !selectedTool) return;
    try {
      const toolId = selectedTool.id;
      let url = `/api/${toolId}/session?id=${selectedSession.id}`;
      if (toolId === "claude-code" && selectedSession.projectPath) {
        url += `&projectPath=${encodeURIComponent(selectedSession.projectPath)}`;
      }
      const data = await fetch(url).then((r) => r.json());
      setMessages(data.messages || []);
    } catch {}
  }, [selectedSession, selectedTool]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (liveMode && selectedSession) {
      pollRef.current = setInterval(refreshSession, 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [liveMode, selectedSession, refreshSession]);

  const handleAddMachine = useCallback(async (m: { name: string; host: string; user: string; port: number; authMethod: "sshKey" | "password"; sshKey?: string; password?: string }) => {
    try {
      const res = await fetch("/api/machines/add", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(m),
      });
      const data = await res.json();
      if (data.machine) {
        setMachines((prev) => [...prev, data.machine]);
      }
    } catch {}
    setShowAddMachine(false);
  }, []);

  const handleRemoveMachine = useCallback(async (id: string) => {
    try {
      await fetch("/api/machines/remove", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id }),
      });
      setMachines((prev) => prev.filter((m) => m.id !== id));
    } catch {}
  }, []);

  const breadcrumb = [
    { label: "Machines", onClick: () => setView("machines") },
    ...(selectedMachine ? [{ label: selectedMachine.name, onClick: () => setView("tools") }] : []),
    ...(selectedTool ? [{ label: selectedTool.name, onClick: () => setView("sessions") }] : []),
    ...(selectedSession ? [{ label: selectedSession.title, onClick: () => {} }] : []),
  ];

  return (
    <div className="flex flex-col h-full">
      <nav className="flex-shrink-0 border-b border-[var(--sidebar-border)] px-6 py-3 flex items-center gap-2 bg-[var(--sidebar-bg)]">
        <div className="flex items-center gap-1 text-sm">
          {breadcrumb.map((item, i) => (
            <span key={i} className="flex items-center gap-1">
              {i > 0 && <span className="text-zinc-600 mx-1">/</span>}
              {i < breadcrumb.length - 1 ? (
                <button onClick={item.onClick} className="text-zinc-500 hover:text-zinc-300 transition-colors">
                  {item.label}
                </button>
              ) : (
                <span className="text-zinc-200 font-medium truncate max-w-[300px]">{item.label}</span>
              )}
            </span>
          ))}
        </div>
        {view === "conversation" && (
          <div className="ml-auto flex items-center gap-2">
            <button
              onClick={() => setLiveMode(!liveMode)}
              className={`text-[11px] px-3 py-1.5 rounded-md border transition-colors font-medium ${
                liveMode
                  ? "border-green-600 text-green-400 bg-green-900/20"
                  : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {liveMode ? "● LIVE" : "○ LIVE"}
            </button>
            <button
              onClick={refreshSession}
              className="text-sm px-2.5 py-1.5 rounded-md border border-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              ↻
            </button>
          </div>
        )}
        {view === "machines" && (
          <button
            onClick={() => setShowAddMachine(true)}
            className="ml-auto text-xs px-3 py-1.5 rounded-md border border-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            + Add Machine
          </button>
        )}
      </nav>

      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <div className="animate-spin h-6 w-6 border-2 border-zinc-600 border-t-zinc-300 rounded-full mr-3" />
            Loading...
          </div>
        ) : view === "machines" ? (
          <MachineCards machines={machines} onSelect={loadTools} onRemove={handleRemoveMachine} />
        ) : view === "tools" ? (
          <ToolCards tools={tools} machine={selectedMachine!} onSelect={loadSessions} />
        ) : view === "sessions" ? (
          <SessionList sessions={sessions} tool={selectedTool!} onSelect={loadSession} />
        ) : (
          <ConversationView messages={messages} sessionMeta={selectedSession} tool={selectedTool!} />
        )}
      </div>

      {showAddMachine && (
        <AddMachineModal onAdd={handleAddMachine} onClose={() => setShowAddMachine(false)} />
      )}
    </div>
  );
}
