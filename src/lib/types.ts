export interface MachineConfig {
  id: string;
  name: string;
  host: string;
  user: string;
  port: number;
  type: "local" | "ssh" | "wsl";
  authMethod: "sshKey" | "password";
  /** type === "wsl" 时的 distro 名；此时 host 存解析好的 UNC home，user 是 Linux 用户名。 */
  distro?: string;
  sshKey?: string;
  password?: string;
  status: "online" | "offline" | "unknown";
  /** true = 从 ~/.ssh/config 自动发现的机器，不写进 machines.json。 */
  auto?: boolean;
}

export interface ToolDefinition {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  detectPaths: string[];
  storageType: "jsonl" | "sqlite" | "json" | "jsonl-dir";
  sessionPathPattern: string;
}

export interface DetectedTool {
  id: string;
  name: string;
  icon: string;
  color: string;
  description: string;
  sessionCount: number;
  detected: boolean;
}

export interface ToolSession {
  id: string;
  title: string;
  createdAt: string;
  messageCount: number;
  project?: string;
  directory?: string;
  model?: string;
  cost?: number;
  tokensInput?: number;
  tokensOutput?: number;
  projectPath?: string;
}

export interface ClaudeSession {
  id: string;
  projectPath: string;
  project?: string;
  title: string;
  createdAt: string;
  messageCount: number;
  filePath: string;
}

export interface OpenCodeSession {
  id: string;
  projectId: string;
  title: string;
  directory: string;
  model: string;
  cost: number;
  tokensInput: number;
  tokensOutput: number;
  tokensReasoning: number;
  timeCreated: number;
  timeUpdated: number;
  agent: string | null;
}

export interface DeepSeekSession {
  id: string;
  title: string;
  model: string;
  workspace: string;
  createdAt: string;
  messageCount: number;
  totalTokens: number;
  filePath: string;
}

export interface CodexSession {
  id: string;
  title: string;
  createdAt: string;
  filePath: string;
  messageCount: number;
}

export interface ClaudeMessage {
  type: string;
  role?: string;
  content?: string | ContentBlock[];
  timestamp?: string;
  uuid?: string;
  parentUuid?: string | null;
  sessionId?: string;
  [key: string]: unknown;
}

export interface ContentBlock {
  type: string;
  text?: string;
  thinking?: string;
  tool_use_id?: string;
  name?: string;
  input?: Record<string, unknown>;
  content?: string;
  id?: string;
}

export interface OpenCodePart {
  id: string;
  type: string;
  text?: string;
  tool?: string;
  callID?: string;
  state?: {
    status: string;
    input?: Record<string, unknown>;
    output?: string;
  };
}

export interface ConversationMessage {
  id: string;
  role: "user" | "assistant" | "system" | "tool";
  content: string;
  timestamp: string;
  thinking?: string;
  toolCalls?: ToolCall[];
  source: string;
  /** 泳道 id：subagent 消息为其 agent id，缺省视为 "main"。 */
  agent?: string;
  /** 泳道显示名（如 "Explore · 分析工具链"）。 */
  agentLabel?: string;
  /** 产生该气泡时所用的模型；null/缺省 = 转录未记录。模型切换会使气泡封口另起新泡。 */
  model?: string | null;
}

/**
 * Outcome of a tool call, as reported by the source format.
 *
 * Mirrors NIR's `NirToolResult["status"]` deliberately rather than inventing a
 * viewer-specific vocabulary: the previous free-form `status?: string` was
 * compared against `"completed"` in the UI while every producer emitted
 * `"success"`, so the badge could never render and the type system could not
 * catch it.
 *
 * The values mean what they say. `cancelled` is a command that was cut off
 * without reporting failure — not an error.
 */
export type ToolStatus = "success" | "error" | "cancelled" | "unknown";

export interface ToolCall {
  id?: string;
  name: string;
  input: Record<string, unknown>;
  output?: string;
  /**
   * Outcome reported by the source. OMITTED — not `"unknown"` — when the source
   * format said nothing at all: an unlabelled call is not a call that failed, and
   * showing a badge for it would assert a fact nobody reported. This distinction
   * is why `status` stays optional instead of defaulting.
   */
  status?: ToolStatus;
  /** Verbatim provider error text, when the source exposed one. */
  errorText?: string;
  /**
   * How the outcome was obtained. `source_*` means the source stated it;
   * `derived` means it was inferred from output text, which is weaker evidence and
   * is rendered differently so a reader never mistakes a guess for a report.
   */
  verdictMethod?: "source_is_error" | "source_status" | "derived";
}

export interface SessionDetail {
  id: string;
  title: string;
  source: string;
  project: string;
  directory: string;
  model?: string;
  cost?: number;
  tokensInput?: number;
  tokensOutput?: number;
  createdAt: string;
  messages: ConversationMessage[];
}
