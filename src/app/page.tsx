"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import type { MachineConfig, DetectedTool, ConversationMessage, ToolSession } from "@/lib/types";
import { useT, getLocale, setLocale } from "@/components/i18n";
import MachineCards from "@/components/MachineCards";
import ToolCards from "@/components/ToolCards";
import SessionList from "@/components/SessionList";
import ConversationView from "@/components/ConversationView";
import AddMachineModal from "@/components/AddMachineModal";

type View = "machines" | "tools" | "sessions" | "conversation";

export default function Home() {
  const t = useT();
  const [view, setView] = useState<View>("machines");
  const [machines, setMachines] = useState<MachineConfig[]>([]);
  const [selectedMachine, setSelectedMachine] = useState<MachineConfig | null>(null);
  const [tools, setTools] = useState<DetectedTool[]>([]);
  const [toolsError, setToolsError] = useState<string | null>(null);
  const [selectedTool, setSelectedTool] = useState<DetectedTool | null>(null);
  const [sessions, setSessions] = useState<ToolSession[]>([]);
  const [sessionsError, setSessionsError] = useState<string | null>(null);
  const [selectedSession, setSelectedSession] = useState<ToolSession | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [sessionError, setSessionError] = useState<string | null>(null);
  // LIVE 轮询用的会话文件指纹；undefined=未初始化，null=工具无指纹（直接刷新）。
  const [lastStamp, setLastStamp] = useState<string | null | undefined>(undefined);
  // toolId -> requiresProjectPath，来自主进程 registry 元数据（避免硬编码 "claude-code"）。
  const toolMetaRef = useRef<Map<string, boolean>>(new Map());
  const [loading, setLoading] = useState(false);
  const [liveMode, setLiveMode] = useState(false);
  const [showAddMachine, setShowAddMachine] = useState(false);
  // 机器操作（添加/删除）失败可见化，不再静默吞掉。
  const [machinesError, setMachinesError] = useState<string | null>(null);
  const [addMachineError, setAddMachineError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);
  // LIVE 轮询在途标记：防止慢连接上 setInterval 重入。
  const pollInFlightRef = useRef(false);

  useEffect(() => {
    window.api.machines.list().then((r) => { if (r.data) setMachines(r.data); }).catch(() => {});
    window.api.tools.meta().then((r) => {
      if (r.data) toolMetaRef.current = new Map(r.data.map((t) => [t.id, t.requiresProjectPath]));
    }).catch(() => {});
  }, []);

  const projectPathFor = useCallback((toolId: string, session: ToolSession): string | undefined =>
    toolMetaRef.current.get(toolId) ? session.projectPath : undefined, []);

  const loadTools = useCallback(async (machine: MachineConfig) => {
    setSelectedMachine(machine);
    setLoading(true);
    setToolsError(null);
    try {
      const r = await window.api.tools.detect(machine.id);
      if (r.error) {
        setToolsError(r.error);
        setTools([]);
      } else {
        setTools(r.data || []);
      }
      setView("tools");
    } catch (e) {
      setToolsError(String(e));
      setTools([]);
      setView("tools");
    }
    setLoading(false);
  }, []);

  const loadSessions = useCallback(async (tool: DetectedTool) => {
    if (!selectedMachine) return;
    setSelectedTool(tool);
    setLoading(true);
    setSessionsError(null);
    try {
      const r = await window.api.sessions.list(selectedMachine.id, tool.id);
      if (r.error) {
        setSessionsError(r.error);
        setSessions([]); // 出错时清空旧列表，避免错误 banner 与过期数据并排显示
      } else {
        setSessions(r.data || []);
      }
      setView("sessions");
    } catch (e) {
      setSessionsError(String(e));
      setSessions([]);
      setView("sessions");
    }
    setLoading(false);
  }, [selectedMachine]);

  const loadSession = useCallback(async (session: ToolSession) => {
    if (!selectedTool || !selectedMachine) return;
    setSelectedSession(session);
    setLoading(true);
    setMessages([]);
    setSessionError(null);
    setLastStamp(undefined);
    try {
      const r = await window.api.sessions.read(
        selectedMachine.id,
        selectedTool.id,
        session.id,
        projectPathFor(selectedTool.id, session)
      );
      if (r.error) setSessionError(r.error);
      else setMessages(r.data || []);
      setView("conversation");
    } catch (e) {
      setSessionError(String(e));
      setView("conversation");
    }
    setLoading(false);
  }, [selectedTool, selectedMachine, projectPathFor]);

  const refreshSession = useCallback(async (force = false) => {
    if (!selectedSession || !selectedTool || !selectedMachine) return;
    // 慢 SSH 上一次刷新可能还没完成：重叠轮询会让慢响应覆盖新数据，直接跳过本拍。
    if (pollInFlightRef.current) return;
    pollInFlightRef.current = true;
    try {
      // LIVE 轮询：先比对文件指纹，没变就不重读全文。
      if (!force) {
        const s = await window.api.sessions.stamp(
          selectedMachine.id,
          selectedTool.id,
          selectedSession.id,
          projectPathFor(selectedTool.id, selectedSession)
        );
        const stamp = s.data ?? null;
        if (stamp !== null && stamp === lastStamp) return;
        setLastStamp(stamp);
      }
      const r = await window.api.sessions.read(
        selectedMachine.id,
        selectedTool.id,
        selectedSession.id,
        projectPathFor(selectedTool.id, selectedSession)
      );
      // 静默刷新（LIVE 轮询）：只在有数据时更新，错误不打断当前内容。
      if (r.error) console.error("refresh failed:", r.error);
      else setMessages(r.data || []);
    } catch {} finally {
      pollInFlightRef.current = false;
    }
  }, [selectedSession, selectedTool, selectedMachine, projectPathFor, lastStamp]);

  useEffect(() => {
    if (pollRef.current) clearInterval(pollRef.current);
    if (liveMode && selectedSession) {
      pollRef.current = setInterval(refreshSession, 3000);
    }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [liveMode, selectedSession, refreshSession]);

  const handleAddMachine = useCallback(async (m: { name: string; host: string; user: string; port: number; authMethod: "sshKey" | "password"; sshKey?: string; password?: string }) => {
    try {
      const r = await window.api.machines.add({ ...m, type: "ssh" });
      if (r.error) {
        setAddMachineError(r.error); // 弹窗保持打开，错误显示在弹窗内
        return;
      }
      if (r.data) setMachines((prev) => [...prev, r.data!]);
      setAddMachineError(null);
      setShowAddMachine(false);
    } catch (e) {
      setAddMachineError(String(e));
    }
  }, []);

  const handleRemoveMachine = useCallback(async (id: string) => {
    setMachinesError(null);
    try {
      const r = await window.api.machines.remove(id);
      if (r && r.error) {
        setMachinesError(r.error);
        return;
      }
      setMachines((prev) => prev.filter((m) => m.id !== id));
    } catch (e) {
      setMachinesError(String(e));
    }
  }, []);

  const breadcrumb = [
    { label: t("nav.machines"), onClick: () => setView("machines") },
    ...(selectedMachine ? [{ label: selectedMachine.name, onClick: () => setView("tools") }] : []),
    ...(selectedTool ? [{ label: selectedTool.name, onClick: () => setView("sessions") }] : []),
    ...(selectedSession ? [{ label: selectedSession.title, onClick: () => {} }] : []),
  ];

  return (
    <div className="flex flex-col h-full">
      <nav aria-label="Breadcrumb" className="flex-shrink-0 border-b border-[var(--sidebar-border)] px-6 py-3 flex items-center gap-2 bg-[var(--sidebar-bg)]">
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
        <div className="ml-auto flex items-center gap-2">
          {view === "conversation" && (
            <>
              <button
                onClick={() => setLiveMode(!liveMode)}
                aria-pressed={liveMode}
                className={`text-[11px] px-3 py-1.5 rounded-md border transition-colors font-medium ${
                  liveMode
                    ? "border-green-600 text-green-400 bg-green-900/20"
                    : "border-zinc-700 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {liveMode ? "● LIVE" : "○ LIVE"}
              </button>
              <button
                onClick={() => refreshSession(true)}
                title={t("nav.refresh")}
                aria-label={t("nav.refresh")}
                className="text-sm px-2.5 py-1.5 rounded-md border border-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
              >
                ↻
              </button>
            </>
          )}
          {view === "machines" && (
            <button
              onClick={() => { setAddMachineError(null); setShowAddMachine(true); }}
              className="text-xs px-3 py-1.5 rounded-md border border-zinc-700 text-zinc-500 hover:text-zinc-300 transition-colors"
            >
              {t("nav.addMachine")}
            </button>
          )}
          <button
            onClick={() => setLocale(getLocale() === "zh" ? "en" : "zh")}
            title={t("lang.label")}
            className="text-[11px] px-2 py-1.5 rounded-md border border-zinc-800 text-zinc-600 hover:text-zinc-400 transition-colors"
          >
            {getLocale() === "zh" ? "EN" : "中文"}
          </button>
        </div>
      </nav>

      <div className="flex-1 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-full text-zinc-500">
            <div className="animate-spin h-6 w-6 border-2 border-zinc-600 border-t-zinc-300 rounded-full mr-3" />
            {t("nav.loading")}
          </div>
        ) : view === "machines" ? (
          <div className="h-full overflow-y-auto">
            {machinesError && (
              <div className="mx-6 mt-4 px-4 py-2.5 rounded-lg border border-red-800/60 bg-red-900/20 text-red-300 text-sm">
                {machinesError}
              </div>
            )}
            <MachineCards machines={machines} onSelect={loadTools} onRemove={handleRemoveMachine} />
          </div>
        ) : view === "tools" ? (
          <ToolCards tools={tools} machine={selectedMachine!} onSelect={loadSessions} error={toolsError} />
        ) : view === "sessions" ? (
          <SessionList sessions={sessions} tool={selectedTool!} onSelect={loadSession} error={sessionsError} />
        ) : (
          <ConversationView messages={messages} sessionMeta={selectedSession} tool={selectedTool!} error={sessionError} />
        )}
      </div>

      {showAddMachine && (
        <AddMachineModal error={addMachineError} onAdd={handleAddMachine} onClose={() => setShowAddMachine(false)} />
      )}
    </div>
  );
}
