export interface MachineConfig {
  id: string;
  name: string;
  host: string;
  user: string;
  port: number;
  type: "local" | "ssh";
  authMethod: "sshKey" | "password";
  sshKey?: string;
  password?: string;
  status: "online" | "offline" | "unknown";
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
}

export interface ToolCall {
  name: string;
  input: Record<string, unknown>;
  output?: string;
  status?: string;
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
