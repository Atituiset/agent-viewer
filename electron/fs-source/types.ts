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
  readDir(p: string): Promise<DirEntry[]>;
  readFile(p: string): Promise<string>;
  readFileBuffer(p: string): Promise<Buffer>;
  stat(p: string): Promise<FileStat>;
  dispose?(): Promise<void>;
}
