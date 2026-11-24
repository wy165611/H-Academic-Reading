"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Bot, Loader2, Send, Trash2, X } from "lucide-react";
import { apiFetch, ChatMessageItem } from "@/lib/api";
import { MarkdownMath } from "@/components/MathText";

interface GlobalAIChatDrawerProps {
  open: boolean;
  onClose: () => void;
}

interface GlobalChatStats {
  paper_count: number;
  highlight_count: number;
  note_count: number;
  anchor_count: number;
}

const GLOBAL_QUICK_PROMPTS = [
  {
    label: "梳理我所有文献的批注与待办",
    prompt:
      "请检索我整个文献库中写过的所有批注和高亮，按文献分类整理出我记录的待办事项、重点想法和需要进一步查阅的内容。",
  },
  {
    label: "总结我在各篇文献中不懂的难点",
    prompt:
      "请根据我在各篇文献中划词发起过的 AI 提问记录和伴读问题，分析并总结我近期阅读时最常卡壳或不懂的知识难点，并给出针对性的复习建议。",
  },
  {
    label: "盘点文献库研究脉络与阅读进度",
    prompt:
      "请盘点我整个文献库里所有论文的研究主题、技术路线演进、以及我当前的阅读进度，帮我规划接下来最值得优先精读的论文顺序。",
  },
  {
    label: "对比我标亮过的所有核心方法与观点",
    prompt:
      "请汇总我在不同文献中高亮标出的核心段落与方法，帮我横向对比它们的异同点、优缺点与可借鉴之处。",
  },
];

export default function GlobalAIChatDrawer({ open, onClose }: GlobalAIChatDrawerProps) {
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState<ChatMessageItem[]>([]);
  const [stats, setStats] = useState<GlobalChatStats | null>(null);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<"high" | "medium" | "low">("high");

  const bottomRef = useRef<HTMLDivElement | null>(null);

  const loadGlobalChat = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch<{
        thread_id: string;
        messages: ChatMessageItem[];
        stats: GlobalChatStats;
      }>("/api/global-chat");
      setMessages(res.messages || []);
      setStats(res.stats || null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载全局 AI 助手失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (open) {
      loadGlobalChat();
    }
  }, [open, loadGlobalChat]);

  useEffect(() => {
    if (open) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [messages, open]);

  async function handleSend(overridePrompt?: string) {
    const q = (overridePrompt ?? input).trim();
    if (!q || sending) return;
    if (!overridePrompt) setInput("");

    setSending(true);
    setError(null);
    try {
      const res = await apiFetch<{
        user_message: ChatMessageItem;
        assistant_message: ChatMessageItem;
      }>("/api/global-chat/messages", {
        method: "POST",
        body: JSON.stringify({
          question: q,
          thinking_level: thinkingLevel,
        }),
      });
      setMessages((prev) => [...prev, res.user_message, res.assistant_message]);
    } catch (err) {
      setError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setSending(false);
    }
  }

  async function handleClear() {
    if (!confirm("确定清空当前全局 AI 对话记录吗？（不会影响任何文献、批注与划词问答）")) {
      return;
    }
    await apiFetch("/api/global-chat/messages", { method: "DELETE" });
    setMessages([]);
  }

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      {/* Backdrop */}
      <div
        className="flex-1 bg-[#1c1c1c]/30"
        onClick={onClose}
      />

      {/* Right Editorial Drawer */}
      <aside className="w-full sm:w-[460px] md:w-[500px] h-[100dvh] bg-[#f9f8f6] border-l border-[#1c1c1c] flex flex-col pwa-safe-top">
        {/* Header */}
        <div className="px-5 py-4 border-b border-[#1c1c1c]/15 flex items-start justify-between gap-3">
          <div className="space-y-1">
            <div className="section-label">Global Library AI</div>
            <h2 className="font-serif text-[22px] leading-tight font-normal flex items-center gap-2">
              <Bot className="w-5 h-5 text-[#816d70]" />
              全局文献库 AI 助手
            </h2>
            {stats && (
              <p className="text-[11px] text-[#6b7280]">
                已实时接入：{stats.paper_count} 篇文献 · {stats.highlight_count} 条高亮 ·{" "}
                {stats.note_count} 条批注 · {stats.anchor_count} 组划词提问
              </p>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {messages.length > 0 && (
              <button
                type="button"
                onClick={handleClear}
                title="清空对话"
                aria-label="清空全局对话"
                className="p-2 border border-[#1c1c1c]/20 text-[#6b7280] hover:text-[#816d70] hover:border-[#816d70] transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="关闭全局 AI 助手"
              className="p-2 border border-[#1c1c1c]/20 hover:bg-[#1c1c1c] hover:text-[#f9f8f6] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Messages Body */}
        <div className="flex-1 min-h-0 overflow-y-auto px-5 py-5 space-y-4">
          {loading ? (
            <div className="py-12 text-center text-[12px] text-[#6b7280] uppercase tracking-[0.18em]">
              正在同步全库阅读记忆...
            </div>
          ) : messages.length === 0 ? (
            <div className="space-y-4">
              <p className="text-[13px] leading-[1.7] text-[#6b7280]">
                我可以读取您整个文献库中的所有论文、阅读进度、高亮批注以及您问过的每一条划词 AI 问题，也可以直接作为通用学术助手回答您的任意提问。
              </p>
              <div className="space-y-2.5">
                {GLOBAL_QUICK_PROMPTS.map((item) => (
                  <button
                    key={item.label}
                    type="button"
                    disabled={sending}
                    onClick={() => handleSend(item.prompt)}
                    className="w-full text-left px-4 py-3 border border-[#1c1c1c]/20 text-[13px] hover:border-[#1c1c1c] hover:bg-[#1c1c1c] hover:text-[#f9f8f6] transition-colors"
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </div>
          ) : (
            <div className="space-y-4">
              {messages.map((msg) => (
                <div
                  key={msg.id}
                  className={`p-3.5 text-[13px] leading-[1.7] ${
                    msg.role === "user"
                      ? "border-l-2 border-[#1c1c1c] bg-[#f2f0ec]"
                      : "border border-[#1c1c1c]/12 bg-[#f9f8f6]"
                  }`}
                >
                  <div className="flex items-center justify-between mb-1.5 text-[10px] uppercase tracking-[0.18em] text-[#6b7280]">
                    <span>{msg.role === "user" ? "我 · 全局提问" : "全局 AI 助手"}</span>
                    {msg.thinking_level && <span>思考: {msg.thinking_level}</span>}
                  </div>
                  {msg.thinking_content && (
                    <details className="mb-2 text-[12px] text-[#6b7280] border-l border-[#1c1c1c]/20 pl-2">
                      <summary className="cursor-pointer select-none">查看推理过程</summary>
                      <div className="mt-1">
                        <MarkdownMath content={msg.thinking_content} />
                      </div>
                    </details>
                  )}
                  <MarkdownMath content={msg.content} />
                </div>
              ))}
            </div>
          )}

          {sending && (
            <div className="p-3 border border-[#1c1c1c]/15 text-[12px] text-[#6b7280] flex items-center gap-2">
              <Loader2 className="w-3.5 h-3.5 animate-spin" />
              正在检索全库文献、批注与历史问答（强度: {thinkingLevel}）...
            </div>
          )}

          {error && (
            <p className="text-[12px] text-[#816d70] border-l-2 border-[#816d70] pl-2.5">
              {error}
            </p>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Composer Footer */}
        <div className="px-5 pt-4 pb-[calc(2.5rem+env(safe-area-inset-bottom,0px))] border-t border-[#1c1c1c]/15 bg-[#f9f8f6] space-y-3">
          <div className="flex items-center justify-between text-[11px] text-[#6b7280]">
            <span>跨文献检索批注、盲区或提出通用科研问题</span>
            <select
              aria-label="全局思考强度"
              value={thinkingLevel}
              onChange={(e) =>
                setThinkingLevel(e.target.value as "high" | "medium" | "low")
              }
              className="bg-[#f9f8f6] border border-[#1c1c1c]/20 pl-2.5 py-1 text-[11px] text-[#1c1c1c]"
            >
              <option value="high">思考: High</option>
              <option value="medium">思考: Medium</option>
              <option value="low">思考: Low</option>
            </select>
          </div>
          <div className="flex gap-2">
            <textarea
              rows={2}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSend();
                }
              }}
              placeholder="例如：我在哪篇论文里批注了要复现？总结我最近不懂的地方..."
              className="flex-1 bg-[#f9f8f6] border border-[#1c1c1c]/25 p-2.5 text-[13px] resize-none focus:border-[#1c1c1c] focus:outline-none"
            />
            <button
              type="button"
              disabled={sending || !input.trim()}
              onClick={() => handleSend()}
              aria-label="发送全局提问"
              className="px-3.5 bg-[#1c1c1c] text-[#f9f8f6] disabled:opacity-40 flex items-center justify-center"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      </aside>
    </div>
  );
}
