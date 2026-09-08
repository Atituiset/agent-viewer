export interface DirEntry {
  name: string;
  isDirectory: boolean;
}

export interface FileStat {
  mtime: Date;
  birthtime?: Date;
}

/**
 * 统一的「在某台机器上读文件」抽象。
 * 解析器（claude/codex/...）只依赖此接口，本机与远程共用同一份代码。
 * 路径约定：相对路径相对 home；绝对路径原样。
 */
export interface FileSource {
  readonly kind: "local" | "ssh";
  readonly home: string;
  exists(p: string): Promise<boolean>;
  /**
   * 批量探测存在性：一条命令/系统调用序列拿回全部结果，替代 N 次串行 exists()
   * （SSH 下每次 exists 是一个独立 exec = 1 RTT，detect 阶段有 N 个 detectPaths）。
   * 未实现时由调用方回退逐个 exists。
   */
  existsBatch?(paths: string[]): Promise<boolean[]>;
  readDir(p: string): Promise<DirEntry[]>;
  readFile(p: string): Promise<string>;
  readFileBuffer(p: string): Promise<Buffer>;
  stat(p: string): Promise<FileStat>;
  /** 只读文件前 maxBytes 字节（列表页取 title 用，避免全文件传输）。 */
  readHead(p: string, maxBytes: number): Promise<string>;
  /** 统计非空行数（jsonl 会话的消息数）。 */
  lineCount(p: string): Promise<number>;
  /** 本地 source 返回绝对路径（sqlite 直接打开用，避免整库拷贝）；远程 source 不实现。 */
  localPath?(p: string): string;
  /**
   * 启发式 agent 发现用：扫描 $HOME 下的候选会话目录（sessions/projects/history 等），
   * 返回相对 home 的目录列表。SSH source 用单条 find 实现（1 个 RTT），本地用 readdir。
   * 未实现则该 source 不参与启发式发现。
   */
  scanAgentStorage?(): Promise<string[]>;
  /**
   * 文件驱动的启发式发现：返回 $HOME 下（含 .config/.local/share 点目录领地，
   * 深度 ≤4，剪枝缓存/构建目录）的转录文件，附带 mtime 用于活跃度排序。
   * 不依赖容器目录名（sessions 等叫什么都行），适合目录命名完全未知的环境。
   */
  scanTranscriptFiles?(): Promise<Array<{ rel: string; mtime: number }>>;
  dispose?(): Promise<void>;
}
