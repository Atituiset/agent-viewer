# user
帮我整理下Opencode 和claude code的本地log和session存储目录，我想做一个viewer观察

# gemini

很高兴你让我重新分析。在我之前的回答中，关于 **OpenCode** 的会话存储结构描述得过于简单，并且存在一定的偏差。经过更深入的底层机制比对后，我发现 Claude Code 和 OpenCode 在存储设计哲学上**截然不同**（一个是单文件流，另一个是高度碎片化的分片存储）。

如果你要写一个 Viewer，理解这两个工具在文件系统 I/O 上的差异至关重要。以下是修正并深化的详细数据存储目录及解析逻辑：

---

### 1. Claude Code：极简的 JSONL 流

Claude Code 的存储设计非常扁平且符合直觉，严格遵循按项目隔离的原则。

* **根数据目录**: `~/.claude/`
* **会话主文件 (核心)**: `~/.claude/projects/<项目路径的URL编码>/<session_id>.jsonl`
* **存储特征**:
* 每一行都是一个独立的 JSON 对象（包含 `user`、`assistant`、`tool_call` 等类型）。
* **优点**：非常适合流式读取和追加，文件损坏风险极低。
* **附件数据**:
* 长文本工具输出会溢出到: `projects/<project>/<session>/tool-results/`
* 被 AI 修改前的代码快照: `file-history/<session>/`





**Viewer 解析策略**：直接按行读取 JSONL，将每行解析为对话气泡（Bubble）。

---

### 2. OpenCode：复杂的碎片化 JSON (Sharded JSONs)

（这是我之前需要纠正的地方）OpenCode 并没有像 Claude 那样使用 JSONL，也没有默认把会话存在当前项目的 `.opencode/` 下。它的会话数据集中统一管理，且被**高度分片**。

* **全局配置**: `~/.config/opencode/opencode.json`
* **全局存储根目录**: `~/.local/share/opencode/storage/` (部分旧版本或 Windows 上可能位于 `~/.opencode/` 或 `%ProgramData%\opencode`)
* **会话存储结构 (核心难点)**:
OpenCode 会将会话切分为 `session`、`message` 和 `part` 三个层级，独立保存为小 JSON 文件。结构如下：
```text
~/.local/share/opencode/storage/
├── session/
│   └── {project-hash}/
│       └── ses_{session_id}.json    <-- 包含元数据（时间、标题、目录）
├── message/
│   └── {session_id}/
│       ├── msg_001_{msg_id}.json    <-- 包含单条消息的 Role 和关联的 session_id
│       └── msg_002_{msg_id}.json
└── part/
    └── {msg_id}/
        ├── 001_{part_id}.json       <-- 包含具体的文本、推理过程 (thinking) 或工具调用
        └── 002_{part_id}.json

```


* **存储特征**:
* **缺点**：对于 Viewer 开发极其不友好，你需要执行大量的文件系统 I/O 操作才能拼接出一条完整的对话。
* **替代方案 (官方导出)**：OpenCode CLI 提供了 `opencode export <session-id>` 命令，可以将其导出为完整的 JSON。



---

### 💡 Viewer 开发避坑指南

如果你的目标是统一观察这两个工具的 Session：

1. **处理 Claude Code** 很容易，直接监听 `~/.claude/projects/` 下的 `.jsonl` 文件变动即可。
2. **处理 OpenCode** 是个挑战。你不应该去监听底层的碎片化 JSON 变动，这样会导致状态极度混乱。
* **建议策略**：在你的 Viewer 中，对于 OpenCode 的日志读取，写一个“组装器（Assembler）”。首先扫描 `session/` 目录获取会话列表，当用户点击某个会话时，再根据 `session_id` 找 `message/`，再根据 `msg_id` 找 `part/`，最后将它们在内存中拼接渲染。



为了让你少走弯路，你需要我提供一段专门用于**重组 OpenCode 碎片化 JSON 文件**的 Python 代码示例吗？