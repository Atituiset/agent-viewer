"use client";

import { memo, useMemo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import rehypeHighlight from "rehype-highlight";

interface Props {
  content: string;
}

function preprocessJsonContent(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length < 2) return text;
  if ((trimmed.startsWith("{") && trimmed.endsWith("}")) || (trimmed.startsWith("[") && trimmed.endsWith("]"))) {
    try {
      const parsed = JSON.parse(trimmed);
      const pretty = JSON.stringify(parsed, null, 2);
      return "```json\n" + pretty + "\n```";
    } catch {
      return text;
    }
  }
  const lines = text.split("\n");
  const allJsonLines = lines.every((line) => {
    const t = line.trim();
    return t === "" || t.startsWith("//") || t.startsWith("#") || ((t.startsWith("{") || t.startsWith("[") || t.startsWith("\"") || t.startsWith(":") || t.startsWith(",") || t.startsWith("}") || t.startsWith("]")) && true);
  });
  if (allJsonLines && lines.length > 2) {
    try {
      const parsed = JSON.parse(trimmed);
      const pretty = JSON.stringify(parsed, null, 2);
      return "```json\n" + pretty + "\n```";
    } catch {}
  }
  return text;
}

/**
 * memo：LIVE 轮询每次 setMessages 都会重渲染整个列表，同一内容不该重新跑
 * markdown 解析 + 语法高亮（大会话里是整个视图里最贵的渲染路径）。
 */
const MarkdownContent = memo(function MarkdownContent({ content }: Props) {
  const processed = useMemo(() => preprocessJsonContent(content), [content]);
  return (
    <div className="message-content text-sm text-zinc-300 leading-relaxed">
      <ReactMarkdown remarkPlugins={[remarkGfm]} rehypePlugins={[rehypeHighlight]}>
        {processed}
      </ReactMarkdown>
    </div>
  );
});

export default MarkdownContent;
