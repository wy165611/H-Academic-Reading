"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useParams } from "next/navigation";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookMarked,
  Bot,
  ChevronDown,
  Image as ImageIcon,
  Languages,
  ListTree,
  Loader2,
  MessageSquarePlus,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Send,
  Sparkles,
  Trash2,
  Type,
  X,
} from "lucide-react";
import {
  apiFetch,
  ChatMessageItem,
  HighlightItem,
  PaperBlockItem,
  PaperItem,
  PaperReaderData,
  QAAnchorItem,
  ReferenceItem,
  useEditorialDialog,
  withAuthTokenUrl,
} from "@/lib/api";
import MathText, { MarkdownMath } from "@/components/MathText";

const PdfOriginalViewer = dynamic(
  () => import("@/components/PdfOriginalViewer"),
  {
    ssr: false,
    loading: () => (
      <div className="py-16 text-center text-[12px] uppercase tracking-[0.2em] text-[#6b7280]">
        正在加载原版 PDF 阅读器...
      </div>
    ),
  }
);

interface SelectionState {
  blockId: string;
  lang: "en" | "zh";
  startOffset: number;
  endOffset: number;
  selectedText: string;
  rectTop: number;
  rectLeft: number;
  rectBottom: number;
}

function getTextOffsetIgnoringMarks(
  root: HTMLElement,
  targetNode: Node,
  targetOffset: number
): number {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent && parent.closest("[data-ignore-offset='true']")) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  let total = 0;
  let current: Node | null = walker.nextNode();
  while (current) {
    if (current === targetNode) {
      return total + targetOffset;
    }
    total += (current.textContent || "").length;
    current = walker.nextNode();
  }
  return total;
}

export default function PaperReaderPage() {
  const params = useParams<{ id: string }>();
  const paperId = params?.id;

  const [data, setData] = useState<PaperReaderData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Reader View Modes
  const [viewMode, setViewMode] = useState<"stream" | "pdf">("stream");
  const [langMode, setLangMode] = useState<"bilingual" | "zh" | "en">("bilingual");

  // Typography Controls (`tx 文字`)
  const [typoOpen, setTypoOpen] = useState(false);
  const [fontSize, setFontSize] = useState<number>(16);
  const [lineHeight, setLineHeight] = useState<number>(1.68);
  const [contentWidth, setContentWidth] = useState<number>(760);
  const [bodyFont, setBodyFont] = useState<"sans" | "serif">("serif");
  const [paragraphIndent, setParagraphIndent] = useState<boolean>(true);

  // Sidebar & Tabs
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<"chat" | "outline" | "figures" | "notes">("chat");
  const [notesFilter, setNotesFilter] = useState<"all" | "anchors" | "highlights">("all");
  const [readingProgress, setReadingProgress] = useState<number>(0);

  // Chat State (Paper Thread vs Active QA Anchor Thread)
  const [activeAnchorId, setActiveAnchorId] = useState<string | null>(null);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState<string | null>(null);
  const [thinkingLevel, setThinkingLevel] = useState<"high" | "medium" | "low">("high");

  // Selection Floating Bar & Inline Popups
  const [selection, setSelection] = useState<SelectionState | null>(null);
  const [askSubMode, setAskSubMode] = useState(false);
  const [askSubInput, setAskSubInput] = useState("");
  const [highlightSubMode, setHighlightSubMode] = useState(false);
  const [highlightNoteInput, setHighlightNoteInput] = useState("");
  const [inlineTranslateResult, setInlineTranslateResult] = useState<{
    blockId: string;
    translation: string;
    loading: boolean;
    saved: boolean;
  } | null>(null);

  // In-place Figure / Reference Popovers
  const [activeFigureModal, setActiveFigureModal] = useState<PaperBlockItem | null>(null);
  const [activeRefPopover, setActiveRefPopover] = useState<{
    refItem: ReferenceItem;
    top: number;
    left: number;
  } | null>(null);

  // Multi-paper synthesis modal
  const [synthOpen, setSynthOpen] = useState(false);
  const [allPapers, setAllPapers] = useState<PaperItem[]>([]);
  const [synthIds, setSynthIds] = useState<string[]>([]);
  const [synthResult, setSynthResult] = useState<string | null>(null);
  const [synthLoading, setSynthLoading] = useState(false);
  const synthDialogRef = useEditorialDialog(synthOpen, () => setSynthOpen(false));

  const streamScrollRef = useRef<HTMLDivElement | null>(null);
  const chatEndRef = useRef<HTMLDivElement | null>(null);
  const [flashBlockId, setFlashBlockId] = useState<string | null>(null);

  const loadReaderData = useCallback(async () => {
    if (!paperId) return;
    try {
      const res = await apiFetch<PaperReaderData>(`/api/papers/${paperId}/reader`);
      setData(res);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "加载论文失败");
    } finally {
      setLoading(false);
    }
  }, [paperId]);

  useEffect(() => {
    loadReaderData();
  }, [loadReaderData]);

  // Poll while paper is still queued or processing
  useEffect(() => {
    if (!data?.paper) return;
    if (data.paper.status !== "queued" && data.paper.status !== "processing") return;
    const t = setInterval(loadReaderData, 3000);
    return () => clearInterval(t);
  }, [data?.paper, loadReaderData]);

  // Scroll reading progress tracker
  useEffect(() => {
    const onScroll = () => {
      const doc = document.documentElement;
      const max = doc.scrollHeight - window.innerHeight;
      if (max <= 0) {
        setReadingProgress(100);
        return;
      }
      setReadingProgress(Math.min(100, Math.max(0, Math.round((window.scrollY / max) * 100))));
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  // Scroll chat to bottom when messages update
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [data?.paper_messages, data?.qa_anchors, activeAnchorId]);

  // Dismiss selection toolbar, translation card, and citation popover when clicking blank area
  useEffect(() => {
    const onDocMouseDown = (e: MouseEvent) => {
      const target = e.target as HTMLElement | null;
      if (target?.closest("[data-floating-ui='true']")) {
        return;
      }
      setSelection(null);
      setAskSubMode(false);
      setAskSubInput("");
      setHighlightSubMode(false);
      setHighlightNoteInput("");
      setInlineTranslateResult(null);
      setActiveRefPopover(null);
      setTypoOpen(false);
    };
    document.addEventListener("mousedown", onDocMouseDown);
    return () => document.removeEventListener("mousedown", onDocMouseDown);
  }, []);

  // Handle text selection inside paragraph blocks
  const handleStreamMouseUp = useCallback(
    (e: React.MouseEvent<HTMLDivElement> | React.TouchEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement | null;
      // Never re-run selection handler when clicking inside floating toolbar / translation card / popovers
      if (target?.closest("[data-floating-ui='true']")) {
        return;
      }
      setTimeout(() => {
      const sel = window.getSelection();
      if (!sel || sel.isCollapsed || !sel.rangeCount) {
        return;
      }
      const selectedText = sel.toString().trim();
      if (!selectedText || selectedText.length < 2) {
        return;
      }

      const range = sel.getRangeAt(0);
      const startEl =
        range.startContainer instanceof HTMLElement
          ? range.startContainer
          : range.startContainer.parentElement;
      const container = startEl?.closest("[data-block-id][data-lang]") as HTMLElement | null;
      if (!container || !streamScrollRef.current) return;

      const blockId = container.getAttribute("data-block-id");
      const lang = container.getAttribute("data-lang") as "en" | "zh" | null;
      if (!blockId || !lang) return;

      // Also verify exact offset against stored plain text string
      const blockObj = data?.blocks.find((b) => b.id === blockId);
      const rawText = lang === "en" ? blockObj?.en || "" : blockObj?.zh || "";

      let startOff = getTextOffsetIgnoringMarks(
        container,
        range.startContainer,
        range.startOffset
      );
      let endOff = getTextOffsetIgnoringMarks(
        container,
        range.endContainer,
        range.endOffset
      );
      if (startOff > endOff) [startOff, endOff] = [endOff, startOff];

      // Safety re-alignment if LaTeX rendered spans shifted text length
      const sliced = rawText.slice(startOff, endOff);
      if (rawText && sliced !== selectedText) {
        const idx = rawText.indexOf(selectedText);
        if (idx !== -1) {
          startOff = idx;
          endOff = idx + selectedText.length;
        }
      }

      const rect = range.getBoundingClientRect();
      const canvasRect = streamScrollRef.current.getBoundingClientRect();
      const relTop = rect.top - canvasRect.top;
      const relBottom = rect.bottom - canvasRect.top;
      const relLeft = rect.left - canvasRect.left;
      const maxLeft = Math.max(12, canvasRect.width - 344);

      setSelection({
        blockId,
        lang,
        startOffset: startOff,
        endOffset: Math.max(startOff + 1, endOff),
        selectedText,
        rectTop: Math.max(8, relTop - 48),
        rectLeft: Math.min(maxLeft, Math.max(12, relLeft + rect.width / 2 - 160)),
        rectBottom: relBottom + 10,
      });
      setAskSubMode(false);
      setHighlightSubMode(false);
      setInlineTranslateResult(null);
    }, 20);
  }, [data?.blocks]);

  const clearSelectionUI = () => {
    setSelection(null);
    setAskSubMode(false);
    setAskSubInput("");
    setHighlightSubMode(false);
    setHighlightNoteInput("");
    setInlineTranslateResult(null);
  };

  // Action 1 & 2: AI Explain / Ask AI (Creates persistent QAAnchor + Thread)
  async function handleAnchorQA(mode: "explain" | "ask", customQuestion?: string) {
    if (!selection || !paperId) return;
    const selSnapshot = { ...selection };
    clearSelectionUI();
    window.getSelection()?.removeAllRanges();

    setChatSending(true);
    setChatError(null);
    setActiveTab("chat");
    setSidebarOpen(true);
    if (window.innerWidth < 1024) setMobileDrawerOpen(true);

    try {
      const createdAnchor = await apiFetch<QAAnchorItem>(`/api/papers/${paperId}/qa-anchors`, {
        method: "POST",
        body: JSON.stringify({
          block_id: selSnapshot.blockId,
          lang: selSnapshot.lang,
          start_offset: selSnapshot.startOffset,
          end_offset: selSnapshot.endOffset,
          selected_text: selSnapshot.selectedText,
          mode,
          question: customQuestion,
          thinking_level: thinkingLevel,
        }),
      });

      setData((prev) =>
        prev
          ? {
              ...prev,
              qa_anchors: [...prev.qa_anchors, createdAnchor],
            }
          : prev
      );
      setActiveAnchorId(createdAnchor.id);
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "AI 解析失败");
    } finally {
      setChatSending(false);
    }
  }

  // Action 3: Contextual Translate Selection
  async function handleInlineTranslate() {
    if (!selection || !paperId) return;
    const blk = data?.blocks.find((b) => b.id === selection.blockId);
    setInlineTranslateResult({
      blockId: selection.blockId,
      translation: "",
      loading: true,
      saved: false,
    });
    try {
      const res = await apiFetch<{ translation: string }>(
        `/api/papers/${paperId}/translate-selection`,
        {
          method: "POST",
          body: JSON.stringify({
            block_id: selection.blockId,
            selected_text: selection.selectedText,
            context_en: blk?.en || "",
          }),
        }
      );
      setInlineTranslateResult({
        blockId: selection.blockId,
        translation: res.translation,
        loading: false,
        saved: false,
      });
    } catch (err) {
      setInlineTranslateResult({
        blockId: selection.blockId,
        translation: err instanceof Error ? err.message : "翻译失败",
        loading: false,
        saved: false,
      });
    }
  }

  async function handleSaveInlineTranslation() {
    if (!inlineTranslateResult || !paperId) return;
    await apiFetch(
      `/api/papers/${paperId}/blocks/${inlineTranslateResult.blockId}/translation`,
      {
        method: "PUT",
        body: JSON.stringify({ zh: inlineTranslateResult.translation }),
      }
    );
    setData((prev) => {
      if (!prev) return prev;
      return {
        ...prev,
        blocks: prev.blocks.map((b) =>
          b.id === inlineTranslateResult.blockId
            ? { ...b, zh: inlineTranslateResult.translation }
            : b
        ),
      };
    });
    setInlineTranslateResult((prev) => (prev ? { ...prev, saved: true } : prev));
  }

  // Action 4: Highlight & Optional Note
  async function handleCreateHighlight(color: "mauve" | "amber" | "sage" | "slate") {
    if (!selection || !paperId) return;
    const created = await apiFetch<HighlightItem>(`/api/papers/${paperId}/highlights`, {
      method: "POST",
      body: JSON.stringify({
        block_id: selection.blockId,
        lang: selection.lang,
        start_offset: selection.startOffset,
        end_offset: selection.endOffset,
        selected_text: selection.selectedText,
        color,
        note: highlightNoteInput.trim() || undefined,
      }),
    });
    setData((prev) =>
      prev ? { ...prev, highlights: [...prev.highlights, created] } : prev
    );
    clearSelectionUI();
    window.getSelection()?.removeAllRanges();
  }

  // Click existing QA Anchor mark in text -> open anchor thread
  const handleClickAnchor = (anchor: QAAnchorItem) => {
    setActiveAnchorId(anchor.id);
    setActiveTab("chat");
    setSidebarOpen(true);
    if (window.innerWidth < 1024) setMobileDrawerOpen(true);
  };

  // Click Fig. X / Table Y -> open in-place figure modal
  const handleClickFigureRef = (label: string) => {
    if (!data) return;
    const norm = label.toLowerCase().replace(/\s+/g, "").replace("figure", "fig.");
    const found = data.blocks.find((b) => {
      if (b.type !== "figure" && b.type !== "table") return false;
      const fl = (b.figure_label || "").toLowerCase().replace(/\s+/g, "").replace("figure", "fig.");
      const cap = (b.caption_en || "").toLowerCase().replace(/\s+/g, "").replace("figure", "fig.");
      return fl.includes(norm) || cap.startsWith(norm) || fl.includes(label.toLowerCase().replace(/\s+/g, ""));
    });
    if (found) {
      setActiveFigureModal(found);
    }
  };

  // Click [13] citation -> open in-place reference card
  const handleClickCitation = (idxStr: string, e: React.MouseEvent<HTMLElement>) => {
    if (!data) return;
    const found = data.references_list.find((r) => String(r.index) === String(idxStr));
    if (!found) return;
    const rect = e.currentTarget.getBoundingClientRect();
    setActiveRefPopover({
      refItem: found,
      top: Math.min(window.innerHeight - 190, rect.bottom + 8),
      left: Math.min(window.innerWidth - 360, Math.max(16, rect.left - 80)),
    });
  };

  // Scroll to block smoothly from Outline / Figures / Notes tabs
  const scrollToBlock = (blockId: string, anchorIdToOpen?: string) => {
    setViewMode("stream");
    setTimeout(() => {
      const el = document.getElementById(`block-${blockId}`);
      if (el) {
        el.scrollIntoView({ behavior: "smooth", block: "center" });
        setFlashBlockId(blockId);
        setTimeout(() => setFlashBlockId(null), 1600);
      }
      if (anchorIdToOpen) {
        setActiveAnchorId(anchorIdToOpen);
        setActiveTab("chat");
      }
    }, 60);
  };

  const activeAnchor = useMemo(
    () => data?.qa_anchors.find((a) => a.id === activeAnchorId) || null,
    [data?.qa_anchors, activeAnchorId]
  );

  const activeThreadId = activeAnchor ? activeAnchor.thread_id : data?.paper_thread_id || "";
  const activeMessages: ChatMessageItem[] = activeAnchor
    ? activeAnchor.messages
    : data?.paper_messages || [];

  async function handleSendChat(overridePrompt?: string) {
    const q = (overridePrompt ?? chatInput).trim();
    if (!q || !activeThreadId) return;
    if (!overridePrompt) setChatInput("");

    setChatSending(true);
    setChatError(null);
    try {
      const res = await apiFetch<{
        user_message: ChatMessageItem;
        assistant_message: ChatMessageItem;
      }>(`/api/threads/${activeThreadId}/messages`, {
        method: "POST",
        body: JSON.stringify({
          question: q,
          thinking_level: thinkingLevel,
        }),
      });

      setData((prev) => {
        if (!prev) return prev;
        if (activeAnchor) {
          return {
            ...prev,
            qa_anchors: prev.qa_anchors.map((a) =>
              a.id === activeAnchor.id
                ? { ...a, messages: [...a.messages, res.user_message, res.assistant_message] }
                : a
            ),
          };
        }
        return {
          ...prev,
          paper_messages: [...prev.paper_messages, res.user_message, res.assistant_message],
        };
      });
    } catch (err) {
      setChatError(err instanceof Error ? err.message : "发送失败");
    } finally {
      setChatSending(false);
    }
  }

  async function handleDeleteAnchor(anchorId: string) {
    await apiFetch(`/api/qa-anchors/${anchorId}`, { method: "DELETE" });
    setData((prev) =>
      prev
        ? { ...prev, qa_anchors: prev.qa_anchors.filter((a) => a.id !== anchorId) }
        : prev
    );
    if (activeAnchorId === anchorId) setActiveAnchorId(null);
  }

  async function handleDeleteHighlight(hlId: string) {
    if (!paperId) return;
    await apiFetch(`/api/papers/${paperId}/highlights/${hlId}`, { method: "DELETE" });
    setData((prev) =>
      prev
        ? { ...prev, highlights: prev.highlights.filter((h) => h.id !== hlId) }
        : prev
    );
  }

  async function openSynthesisModal() {
    setSynthOpen(true);
    setSynthResult(null);
    const list = await apiFetch<PaperItem[]>("/api/papers");
    setAllPapers(list);
    if (paperId && !synthIds.includes(paperId)) {
      setSynthIds([paperId]);
    }
  }

  async function runSynthesisInReader() {
    if (synthIds.length < 2) return;
    setSynthLoading(true);
    try {
      const res = await apiFetch<{
        messages: { content: string }[];
      }>("/api/synthesis", {
        method: "POST",
        body: JSON.stringify({
          paper_ids: synthIds,
          thinking_level: thinkingLevel,
        }),
      });
      setSynthResult(res.messages[res.messages.length - 1]?.content || "");
    } finally {
      setSynthLoading(false);
    }
  }

  const figureBlocks = useMemo(
    () => (data?.blocks || []).filter((b) => b.type === "figure" || b.type === "table"),
    [data?.blocks]
  );

  if (loading) {
    return (
      <main className="min-h-screen bg-[#f9f8f6] flex items-center justify-center text-[12px] uppercase tracking-[0.2em] text-[#6b7280]">
        正在载入文献精读视图...
      </main>
    );
  }

  if (error || !data) {
    return (
      <main className="min-h-screen bg-[#f9f8f6] flex flex-col items-center justify-center gap-4 p-6">
        <p className="text-[14px] text-[#816d70]">{error || "未找到该文献"}</p>
        <Link href="/" className="btn-editorial-outline">
          返回文献库
        </Link>
      </main>
    );
  }

  const { paper } = data;

  const sidebarPanel = (
    <div className="flex flex-col h-full bg-[#f9f8f6]">
      {/* 4 Tabs Header */}
      <div className="grid grid-cols-4 border-b border-[#1c1c1c]/15 text-[11px] uppercase tracking-[0.12em]">
        {[
          { id: "chat", label: "AI 问答", icon: Bot },
          { id: "outline", label: "目录", icon: ListTree },
          { id: "figures", label: "图表", icon: ImageIcon },
          { id: "notes", label: "笔记与问答", icon: BookMarked },
        ].map((tab) => {
          const Icon = tab.icon;
          const active = activeTab === tab.id;
          return (
            <button
              key={tab.id}
              type="button"
              onClick={() => setActiveTab(tab.id as typeof activeTab)}
              className={`py-3 px-1 flex flex-col items-center gap-1 border-b-2 transition-colors focus:outline-none focus-visible:bg-[#1c1c1c]/[0.05] ${
                active
                  ? "border-[#1c1c1c] text-[#1c1c1c] font-medium"
                  : "border-transparent text-[#6b7280] hover:text-[#1c1c1c]"
              }`}
            >
              <Icon className="w-3.5 h-3.5" />
              <span className="truncate max-w-full">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {/* Tab Body */}
      <div className="flex-1 overflow-y-auto p-4">
        {activeTab === "chat" && (
          <div className="flex flex-col h-full justify-between gap-4">
            <div className="space-y-4">
              {/* Thread Mode Banner: Anchor vs Full Paper */}
              {activeAnchor ? (
                <div className="border border-[#816d70] p-3 bg-[#816d70]/[0.06] space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-[11px] uppercase tracking-[0.16em] text-[#816d70] font-medium">
                      划词锚点专属对话
                    </span>
                    <button
                      type="button"
                      onClick={() => setActiveAnchorId(null)}
                      className="text-[11px] underline text-[#1c1c1c]"
                    >
                      ← 返回全文对话
                    </button>
                  </div>
                  <p className="text-[12px] text-[#1c1c1c]/85 italic border-l-2 border-[#816d70] pl-2.5 line-clamp-4">
                    “{activeAnchor.selected_text}”
                  </p>
                  <button
                    type="button"
                    onClick={() => scrollToBlock(activeAnchor.block_id)}
                    className="text-[11px] text-[#6b7280] hover:text-[#1c1c1c] underline"
                  >
                    定位原文段落
                  </button>
                </div>
              ) : (
                <div className="flex items-center justify-between border-b border-[#1c1c1c]/10 pb-2">
                  <span className="text-[11px] uppercase tracking-[0.18em] text-[#6b7280]">
                    全文 AI 伴读线程
                  </span>
                  {data.qa_anchors.length > 0 && (
                    <button
                      type="button"
                      onClick={() => {
                        setActiveTab("notes");
                        setNotesFilter("anchors");
                      }}
                      className="text-[11px] text-[#816d70] underline"
                    >
                      已保存 {data.qa_anchors.length} 条划词问答
                    </button>
                  )}
                </div>
              )}

              {/* Empty State Quick Prompts */}
              {activeMessages.length === 0 && !activeAnchor && (
                <div className="space-y-2.5 pt-2">
                  <div className="text-[12px] text-[#6b7280] mb-2">
                    选择预设指令开始研读，或在正文划词发起锚点问答：
                  </div>
                  {[
                    {
                      label: "总结论文",
                      prompt: "请用清晰结构总结这篇论文的核心问题、主要方法、关键创新与实验结论。",
                    },
                    {
                      label: "梳理论文大纲",
                      prompt: "请按章节脉络梳理本篇论文的论证大纲与各节核心贡献。",
                    },
                    {
                      label: "提取研究方法与实验结论",
                      prompt: "请详细提取本论文的研究方法细节、核心公式含义、实验设置及主要量化结论。",
                    },
                    {
                      label: "生成一份学习指南",
                      prompt: "请为我生成一份针对这篇论文的学习指南（先导背景知识、精读重点、容易忽视的假设与思考题）。",
                    },
                  ].map((item) => (
                    <button
                      key={item.label}
                      type="button"
                      disabled={chatSending}
                      onClick={() => handleSendChat(item.prompt)}
                      className="w-full text-left px-3.5 py-2.5 border border-[#1c1c1c]/20 text-[13px] hover:border-[#1c1c1c] hover:bg-[#1c1c1c] hover:text-[#f9f8f6] transition-colors"
                    >
                      {item.label}
                    </button>
                  ))}
                  <button
                    type="button"
                    onClick={openSynthesisModal}
                    className="w-full text-left px-3.5 py-2.5 border border-[#816d70] text-[13px] text-[#816d70] hover:bg-[#816d70] hover:text-[#f9f8f6] transition-colors flex items-center gap-2"
                  >
                    <Sparkles className="w-3.5 h-3.5" />
                    多篇文献生成综述报告
                  </button>
                </div>
              )}

              {/* Chat Messages List */}
              <div className="space-y-4">
                {activeMessages.map((msg) => (
                  <div
                    key={msg.id}
                    className={`p-3.5 text-[13px] leading-[1.7] ${
                      msg.role === "user"
                        ? "border-l-2 border-[#1c1c1c] bg-[#f2f0ec]"
                        : "border border-[#1c1c1c]/12 bg-[#f9f8f6]"
                    }`}
                  >
                    <div className="flex items-center justify-between mb-1.5 text-[10px] uppercase tracking-[0.18em] text-[#6b7280]">
                      <span>{msg.role === "user" ? "我 · 提问" : "AI 伴读助手"}</span>
                      {msg.thinking_level && (
                        <span>思考: {msg.thinking_level}</span>
                      )}
                    </div>
                    {msg.thinking_content && (
                      <details className="mb-2 text-[12px] text-[#6b7280] border-l border-[#1c1c1c]/20 pl-2">
                        <summary className="cursor-pointer select-none">查看推理过程</summary>
                        <div className="mt-1">
                          <MarkdownMath content={msg.thinking_content} />
                        </div>
                      </details>
                    )}
                    <div>
                      <MarkdownMath content={msg.content} />
                    </div>
                  </div>
                ))}
                {chatSending && (
                  <div className="p-3 border border-[#1c1c1c]/15 text-[12px] text-[#6b7280] flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    正在思考并组织解答（强度: {thinkingLevel}）...
                  </div>
                )}
                {chatError && (
                  <p className="text-[12px] text-[#816d70] border-l-2 border-[#816d70] pl-2.5">
                    {chatError}
                  </p>
                )}
                <div ref={chatEndRef} />
              </div>
            </div>
          </div>
        )}

        {activeTab === "outline" && (
          <div className="space-y-4">
            <div className="flex items-center justify-between text-[12px] text-[#6b7280] border-b border-[#1c1c1c]/10 pb-2">
              <span>章节目录</span>
              <span>阅读进度 {readingProgress}%</span>
            </div>
            {data.outline.length === 0 ? (
              <p className="text-[13px] text-[#6b7280]">暂无抽取目录。</p>
            ) : (
              <ul className="space-y-2">
                {data.outline.map((sec) => {
                  const targetBlk = data.blocks.find(
                    (b) => b.type === "heading" && b.section_id === sec.id
                  );
                  return (
                    <li
                      key={sec.id}
                      style={{ paddingLeft: `${(sec.level - 1) * 14}px` }}
                    >
                      <button
                        type="button"
                        onClick={() => targetBlk && scrollToBlock(targetBlk.id)}
                        className="w-full text-left py-1.5 text-[13px] hover:text-[#816d70] transition-colors border-b border-[#1c1c1c]/5"
                      >
                        <div className="font-medium leading-snug">
                          {sec.title_zh || sec.title_en}
                        </div>
                        {sec.title_zh && (
                          <div className="text-[11px] text-[#6b7280] truncate">
                            {sec.title_en}
                          </div>
                        )}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>
        )}

        {activeTab === "figures" && (
          <div className="space-y-4">
            <div className="text-[12px] text-[#6b7280] border-b border-[#1c1c1c]/10 pb-2">
              共提取 {figureBlocks.length} 处图表
            </div>
            {figureBlocks.length === 0 ? (
              <p className="text-[13px] text-[#6b7280]">本文暂未检测到提取图表。</p>
            ) : (
              <div className="space-y-5">
                {figureBlocks.map((fb) => (
                  <div
                    key={fb.id}
                    className="border border-[#1c1c1c]/15 p-3 space-y-2 hover:border-[#1c1c1c]/40 transition-colors"
                  >
                    <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.15em] text-[#6b7280]">
                      <span>{fb.figure_label || fb.type}</span>
                      <button
                        type="button"
                        onClick={() => scrollToBlock(fb.id)}
                        className="underline text-[#1c1c1c]"
                      >
                        跳转至 P.{fb.page_num}
                      </button>
                    </div>
                    {fb.figure_url && (
                      <img
                        src={withAuthTokenUrl(fb.figure_url)}
                        alt={fb.figure_label || "Figure"}
                        onClick={() => setActiveFigureModal(fb)}
                        className="w-full max-h-48 object-contain bg-white border border-[#1c1c1c]/10 cursor-pointer"
                      />
                    )}
                    <p className="text-[12px] text-[#1c1c1c]/85 leading-relaxed line-clamp-3">
                      {fb.caption_zh || fb.caption_en}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {activeTab === "notes" && (
          <div className="space-y-4">
            <div className="flex gap-1.5 border-b border-[#1c1c1c]/10 pb-3 text-[11px]">
              {[
                { id: "all", label: "全部" },
                { id: "anchors", label: `划词问答 (${data.qa_anchors.length})` },
                { id: "highlights", label: `高亮批注 (${data.highlights.length})` },
              ].map((f) => (
                <button
                  key={f.id}
                  type="button"
                  onClick={() => setNotesFilter(f.id as typeof notesFilter)}
                  className={`px-2.5 py-1 border ${
                    notesFilter === f.id
                      ? "border-[#1c1c1c] bg-[#1c1c1c] text-[#f9f8f6]"
                      : "border-[#1c1c1c]/20"
                  }`}
                >
                  {f.label}
                </button>
              ))}
            </div>

            {(notesFilter === "all" || notesFilter === "anchors") && (
              <div className="space-y-3">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#816d70]">
                  已保存的划词 AI 问答
                </div>
                {data.qa_anchors.length === 0 ? (
                  <p className="text-[12px] text-[#6b7280]">
                    选中正文点击「AI 解释」或「问问 AI」即可永久保存问答锚点。
                  </p>
                ) : (
                  data.qa_anchors.map((anc) => (
                    <div
                      key={anc.id}
                      onClick={() => scrollToBlock(anc.block_id, anc.id)}
                      className="border border-[#816d70]/45 p-3 space-y-2 cursor-pointer hover:border-[#816d70] transition-colors"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[12px] italic border-l-2 border-[#816d70] pl-2 line-clamp-2">
                          “{anc.selected_text}”
                        </p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteAnchor(anc.id);
                          }}
                          aria-label="删除问答锚点"
                          className="text-[#6b7280] hover:text-[#816d70] shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      <p className="text-[12px] text-[#6b7280] line-clamp-2">
                        {anc.messages[anc.messages.length - 1]?.content || ""}
                      </p>
                      <div className="text-[10px] uppercase tracking-[0.14em] text-[#816d70]">
                        {Math.floor((anc.messages?.length || 2) / 2)} 轮对话 · 点击回看并追问
                      </div>
                    </div>
                  ))
                )}
              </div>
            )}

            {(notesFilter === "all" || notesFilter === "highlights") && (
              <div className="space-y-3 pt-2">
                <div className="text-[11px] uppercase tracking-[0.18em] text-[#6b7280]">
                  高亮与批注
                </div>
                {data.highlights.length === 0 ? (
                  <p className="text-[12px] text-[#6b7280]">暂无高亮记录。</p>
                ) : (
                  data.highlights.map((hl) => (
                    <div
                      key={hl.id}
                      onClick={() => scrollToBlock(hl.block_id)}
                      className="border border-[#1c1c1c]/15 p-3 space-y-1.5 cursor-pointer hover:border-[#1c1c1c]/50"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className={`text-[12px] px-1 hl-${hl.color} line-clamp-3`}>
                          {hl.selected_text}
                        </p>
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDeleteHighlight(hl.id);
                          }}
                          aria-label="删除高亮"
                          className="text-[#6b7280] hover:text-[#816d70] shrink-0"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                      {hl.note && (
                        <p className="text-[12px] text-[#1c1c1c] pt-1 border-t border-[#1c1c1c]/10">
                          批注：{hl.note}
                        </p>
                      )}
                    </div>
                  ))
                )}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Chat Composer Footer (shown on Chat Tab) */}
      {activeTab === "chat" && (
        <div className="px-4 pt-4 pb-[calc(2.75rem+env(safe-area-inset-bottom,0px))] border-t border-[#1c1c1c]/15 bg-[#f9f8f6] space-y-3">
          <div className="flex items-center justify-between text-[11px] text-[#6b7280]">
            <span>{activeAnchor ? "向当前锚点继续追问" : "向全文 AI 提问"}</span>
            <select
              aria-label="思考强度"
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
              value={chatInput}
              onChange={(e) => setChatInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  handleSendChat();
                }
              }}
              placeholder={
                activeAnchor
                  ? "针对这段选区继续追问..."
                  : "输入关于本论文的任意问题..."
              }
              className="flex-1 bg-[#f9f8f6] border border-[#1c1c1c]/25 p-2.5 text-[13px] resize-none focus:border-[#1c1c1c] focus:outline-none"
            />
            <button
              type="button"
              disabled={chatSending || !chatInput.trim()}
              onClick={() => handleSendChat()}
              aria-label="发送提问"
              className="px-3.5 bg-[#1c1c1c] text-[#f9f8f6] disabled:opacity-40 flex items-center justify-center"
            >
              <Send className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f9f8f6] text-[#1c1c1c] flex flex-col pwa-safe-top">
      {/* Sticky Top Reading Toolbar */}
      <header className="sticky top-0 z-30 bg-[#f9f8f6]/95 backdrop-blur-sm border-b border-[#1c1c1c]/15 px-4 md:px-8 h-14 flex items-center justify-between gap-3">
        <div className="flex items-center gap-3 min-w-0">
          <Link
            href="/"
            className="inline-flex items-center gap-1.5 text-[12px] uppercase tracking-[0.16em] hover:text-[#816d70] shrink-0"
          >
            <ArrowLeft className="w-4 h-4" />
            <span className="hidden sm:inline">文献库</span>
          </Link>
          <span className="text-[#1c1c1c]/20">|</span>
          <h1 className="font-serif text-[15px] md:text-[17px] truncate">
            {paper.title_zh || paper.title}
          </h1>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          {/* Stream vs Original PDF */}
          <div className="inline-flex h-8 border border-[#1c1c1c]/25 text-[11px]">
            <button
              type="button"
              onClick={() => setViewMode("stream")}
              className={`px-2.5 h-full inline-flex items-center ${
                viewMode === "stream" ? "bg-[#1c1c1c] text-[#f9f8f6]" : "hover:bg-[#1c1c1c]/5"
              }`}
            >
              流式重排
            </button>
            <button
              type="button"
              onClick={() => setViewMode("pdf")}
              className={`px-2.5 h-full inline-flex items-center border-l border-[#1c1c1c]/25 ${
                viewMode === "pdf" ? "bg-[#1c1c1c] text-[#f9f8f6]" : "hover:bg-[#1c1c1c]/5"
              }`}
            >
              原版 PDF
            </button>
          </div>

          {/* Bilingual / ZH / EN */}
          {viewMode === "stream" && (
            <div className="hidden sm:inline-flex h-8 border border-[#1c1c1c]/25 text-[11px]">
              {[
                { id: "bilingual", label: "双语" },
                { id: "zh", label: "中文" },
                { id: "en", label: "英文" },
              ].map((m, idx) => (
                <button
                  key={m.id}
                  type="button"
                  onClick={() => setLangMode(m.id as typeof langMode)}
                  className={`px-2.5 h-full inline-flex items-center ${idx > 0 ? "border-l border-[#1c1c1c]/25" : ""} ${
                    langMode === m.id ? "bg-[#1c1c1c] text-[#f9f8f6]" : "hover:bg-[#1c1c1c]/5"
                  }`}
                >
                  {m.label}
                </button>
              ))}
            </div>
          )}

          {/* Typography `tx 文字` Popover */}
          <div className="relative" data-floating-ui="true">
            <button
              type="button"
              onClick={() => setTypoOpen((v) => !v)}
              className="h-8 px-2.5 border border-[#1c1c1c]/25 text-[11px] inline-flex items-center gap-1 hover:border-[#1c1c1c]"
            >
              <Type className="w-3.5 h-3.5" />
              <span className="hidden md:inline">tx 文字</span>
            </button>

            {typoOpen && (
              <div className="absolute right-0 top-10 z-40 w-64 bg-[#f9f8f6] border border-[#1c1c1c] p-4 space-y-3 text-[12px]">
                <div className="flex items-center justify-between">
                  <span className="text-[#6b7280]">字号 ({fontSize}px)</span>
                  <div className="flex border border-[#1c1c1c]/25">
                    <button
                      type="button"
                      onClick={() => setFontSize((s) => Math.max(13, s - 1))}
                      className="px-2.5 py-1"
                    >
                      A-
                    </button>
                    <button
                      type="button"
                      onClick={() => setFontSize((s) => Math.min(22, s + 1))}
                      className="px-2.5 py-1 border-l border-[#1c1c1c]/25"
                    >
                      A+
                    </button>
                  </div>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#6b7280]">行距</span>
                  <select
                    value={lineHeight}
                    onChange={(e) => setLineHeight(parseFloat(e.target.value))}
                    className="border border-[#1c1c1c]/25 bg-[#f9f8f6] pl-2 py-1"
                  >
                    <option value={1.55}>紧凑 1.55</option>
                    <option value={1.68}>标准 1.68</option>
                    <option value={1.9}>宽松 1.90</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#6b7280]">首行缩进</span>
                  <button
                    type="button"
                    onClick={() => setParagraphIndent((v) => !v)}
                    className={`px-2.5 py-1 border border-[#1c1c1c]/25 ${
                      paragraphIndent ? "bg-[#1c1c1c] text-[#f9f8f6]" : "bg-[#f9f8f6]"
                    }`}
                  >
                    {paragraphIndent ? "已开启 2em" : "已关闭"}
                  </button>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#6b7280]">版心宽度</span>
                  <select
                    value={contentWidth}
                    onChange={(e) => setContentWidth(parseInt(e.target.value, 10))}
                    className="border border-[#1c1c1c]/25 bg-[#f9f8f6] px-2 py-1"
                  >
                    <option value={640}>窄栏 640px</option>
                    <option value={760}>标准 760px</option>
                    <option value={900}>宽栏 900px</option>
                  </select>
                </div>
                <div className="flex items-center justify-between">
                  <span className="text-[#6b7280]">正文字体</span>
                  <div className="flex border border-[#1c1c1c]/25">
                    <button
                      type="button"
                      onClick={() => setBodyFont("sans")}
                      className={`px-2 py-1 ${
                        bodyFont === "sans" ? "bg-[#1c1c1c] text-[#f9f8f6]" : ""
                      }`}
                    >
                      无衬线
                    </button>
                    <button
                      type="button"
                      onClick={() => setBodyFont("serif")}
                      className={`px-2 py-1 border-l border-[#1c1c1c]/25 ${
                        bodyFont === "serif" ? "bg-[#1c1c1c] text-[#f9f8f6]" : ""
                      }`}
                    >
                      衬线
                    </button>
                  </div>
                </div>
              </div>
            )}
          </div>

          {/* Toggle AI Companion Sidebar */}
          <button
            type="button"
            onClick={() => {
              if (window.innerWidth < 1024) setMobileDrawerOpen((v) => !v);
              else setSidebarOpen((v) => !v);
            }}
            aria-label="切换 AI 伴读侧栏"
            className="w-8 h-8 inline-flex items-center justify-center border border-[#1c1c1c]/25 hover:bg-[#1c1c1c] hover:text-[#f9f8f6] transition-colors"
          >
            {sidebarOpen ? (
              <PanelRightClose className="w-4 h-4" />
            ) : (
              <PanelRightOpen className="w-4 h-4" />
            )}
          </button>
        </div>
      </header>

      {/* Main Split Body */}
      <div className="flex-1 flex min-w-0">
        {/* Reading Canvas */}
        <div
          ref={streamScrollRef}
          onMouseUp={handleStreamMouseUp}
          onTouchEnd={handleStreamMouseUp}
          className="relative flex-1 min-w-0 px-5 md:px-10 py-8 md:py-12"
        >
          {/* Mobile Language Switcher */}
          {viewMode === "stream" && (
            <div className="sm:hidden flex justify-center mb-6">
              <div className="inline-flex border border-[#1c1c1c]/25 text-[11px]">
                {[
                  { id: "bilingual", label: "双语对照" },
                  { id: "zh", label: "纯中文" },
                  { id: "en", label: "纯英文" },
                ].map((m, idx) => (
                  <button
                    key={m.id}
                    type="button"
                    onClick={() => setLangMode(m.id as typeof langMode)}
                    className={`px-3 py-1.5 ${idx > 0 ? "border-l border-[#1c1c1c]/25" : ""} ${
                      langMode === m.id ? "bg-[#1c1c1c] text-[#f9f8f6]" : ""
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>
            </div>
          )}

          {viewMode === "pdf" ? (
            <PdfOriginalViewer pdfUrl={paper.pdf_url} />
          ) : (
            <article
              style={{ maxWidth: `${contentWidth}px` }}
              className="mx-auto space-y-8 pb-24"
            >
              {/* Paper Masthead */}
              <header className="border-b border-[#1c1c1c]/15 pb-8 space-y-5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="section-label">
                    {paper.venue || "Academic Paper"} {paper.year ? `· ${paper.year}` : ""}
                  </span>
                  {(paper.journal_tier || []).map((tier) => (
                    <span
                      key={tier}
                      className="px-2 py-0.5 text-[11px] uppercase tracking-[0.14em] border border-[#816d70] text-[#816d70]"
                    >
                      {tier}
                    </span>
                  ))}
                </div>

                <h2 className="font-serif text-[32px] md:text-[42px] leading-[1.12] tracking-[-0.02em] font-normal">
                  {paper.title_zh || paper.title}
                </h2>

                {paper.title_zh && (
                  <p className="font-serif text-[20px] leading-[1.35] text-[#6b7280]">
                    {paper.title}
                  </p>
                )}

                {paper.authors.length > 0 && (
                  <p className="text-[13px] text-[#6b7280] leading-[1.6]">
                    {paper.authors.join(" · ")}
                  </p>
                )}

                {(paper.status === "queued" || paper.status === "processing") && (
                  <div className="border border-[#1c1c1c] p-4 space-y-2 text-[13px]">
                    <div className="flex items-center justify-between">
                      <span>{paper.progress_message}</span>
                      <span>{paper.progress}%</span>
                    </div>
                    <div className="w-full h-[2px] bg-[#1c1c1c]/10">
                      <div
                        className="h-full bg-[#1c1c1c] transition-all"
                        style={{ width: `${paper.progress}%` }}
                      />
                    </div>
                  </div>
                )}

                {paper.status === "failed" && (
                  <div className="border border-[#816d70] p-4 space-y-2 text-[13px] text-[#816d70]">
                    <div>解析中断：{paper.error_message || paper.progress_message}</div>
                    <button
                      type="button"
                      onClick={async () => {
                        await apiFetch(`/api/papers/${paper.id}/reparse`, { method: "POST" });
                        loadReaderData();
                      }}
                      className="btn-editorial-outline text-[11px] py-1.5 px-3"
                    >
                      <RefreshCw className="w-3.5 h-3.5" />
                      从断点重新解析
                    </button>
                  </div>
                )}

                {(paper.abstract_en || paper.abstract_zh) && (
                  <div className="border-l-2 border-[#1c1c1c] pl-5 py-1 space-y-3 bg-[#f3f1ed]/60 p-4">
                    <div className="text-[11px] uppercase tracking-[0.2em] text-[#6b7280]">
                      Abstract / 摘要
                    </div>
                    {langMode !== "zh" && paper.abstract_en && (
                      <p className="text-[14px] leading-[1.7] text-[#1c1c1c]/90">
                        {paper.abstract_en}
                      </p>
                    )}
                    {langMode !== "en" && paper.abstract_zh && (
                      <p className="text-[14px] leading-[1.75] text-[#1c1c1c]">
                        {paper.abstract_zh}
                      </p>
                    )}
                  </div>
                )}
              </header>

              {/* Stream Reflowed Blocks */}
              <div
                style={{
                  fontSize: `${fontSize}px`,
                  lineHeight,
                  fontFamily:
                    bodyFont === "serif" ? "var(--font-serif)" : "var(--font-sans)",
                }}
                className="space-y-6"
              >
                {data.blocks.map((blk) => {
                  const isFlashed = flashBlockId === blk.id;
                  const blockHighlights = data.highlights.filter(
                    (h) => h.block_id === blk.id
                  );
                  const blockAnchors = data.qa_anchors.filter(
                    (a) => a.block_id === blk.id
                  );

                  if (blk.type === "heading") {
                    const sizeCls =
                      blk.heading_level === 1
                        ? "text-[26px] md:text-[30px] mt-10 pt-6 border-t border-[#1c1c1c]/15"
                        : blk.heading_level === 2
                        ? "text-[21px] md:text-[24px] mt-7"
                        : "text-[18px] mt-5";
                    return (
                      <div
                        key={blk.id}
                        id={`block-${blk.id}`}
                        className={`space-y-1 transition-colors duration-500 ${sizeCls} ${
                          isFlashed ? "bg-[#816d70]/15 p-2" : ""
                        }`}
                      >
                        {langMode !== "zh" && (
                          <h3 className="font-serif font-normal leading-[1.25]">
                            <MathText text={blk.en} disableInteractiveTokens />
                          </h3>
                        )}
                        {langMode !== "en" && blk.zh && (
                          <h3 className="font-serif font-normal leading-[1.3] text-[#1c1c1c]/85">
                            <MathText text={blk.zh} disableInteractiveTokens />
                          </h3>
                        )}
                      </div>
                    );
                  }

                  if (blk.type === "equation") {
                    return (
                      <div
                        key={blk.id}
                        id={`block-${blk.id}`}
                        className={`py-3 px-4 border-l-2 border-[#1c1c1c]/20 overflow-x-auto ${
                          isFlashed ? "bg-[#816d70]/15" : ""
                        }`}
                      >
                        <MathText text={blk.en} disableInteractiveTokens />
                      </div>
                    );
                  }

                  if (blk.type === "figure" || blk.type === "table") {
                    return (
                      <figure
                        key={blk.id}
                        id={`block-${blk.id}`}
                        className={`my-8 border border-[#1c1c1c]/15 p-5 bg-[#f3f1ed]/50 space-y-3 ${
                          isFlashed ? "ring-2 ring-[#816d70]" : ""
                        }`}
                      >
                        {blk.figure_url && (
                          <div className="bg-white border border-[#1c1c1c]/10 p-2 flex justify-center">
                            <img
                              src={withAuthTokenUrl(blk.figure_url)}
                              alt={blk.figure_label || "Extracted figure"}
                              onClick={() => setActiveFigureModal(blk)}
                              className="max-h-[460px] object-contain cursor-zoom-in"
                            />
                          </div>
                        )}
                        <figcaption className="space-y-1.5 text-[13px] leading-[1.65] text-[#6b7280]">
                          {langMode !== "zh" && blk.caption_en && (
                            <div>
                              <MathText text={blk.caption_en} disableInteractiveTokens />
                            </div>
                          )}
                          {langMode !== "en" && blk.caption_zh && (
                            <div className="text-[#1c1c1c]/90">
                              <MathText text={blk.caption_zh} disableInteractiveTokens />
                            </div>
                          )}
                        </figcaption>
                      </figure>
                    );
                  }

                  // Normal paragraph / quote
                  const isDuplicateZh =
                    langMode === "bilingual" &&
                    Boolean(blk.en && blk.zh) &&
                    blk.en.replace(/\s+/g, "") === blk.zh.replace(/\s+/g, "");

                  return (
                    <div
                      key={blk.id}
                      id={`block-${blk.id}`}
                      className={`space-y-3 transition-colors duration-500 ${
                        isFlashed ? "bg-[#816d70]/15 p-2" : ""
                      }`}
                    >
                      {langMode !== "zh" && blk.en && (
                        <p
                          data-block-id={blk.id}
                          data-lang="en"
                          className={`text-[#1c1c1c] text-justify ${
                            paragraphIndent ? "indent-[2em]" : ""
                          }`}
                        >
                          <MathText
                            text={blk.en}
                            blockId={blk.id}
                            lang="en"
                            highlights={blockHighlights.filter((h) => h.lang === "en")}
                            anchors={blockAnchors.filter((a) => a.lang === "en")}
                            activeAnchorId={activeAnchorId}
                            onClickAnchor={handleClickAnchor}
                            onClickCitation={handleClickCitation}
                            onClickFigureRef={handleClickFigureRef}
                          />
                        </p>
                      )}
                      {langMode !== "en" && blk.zh && !isDuplicateZh && (
                        <p
                          data-block-id={blk.id}
                          data-lang="zh"
                          className={`text-justify ${
                            langMode === "bilingual"
                              ? "text-[#1c1c1c]/82 pl-3.5 border-l border-[#1c1c1c]/15"
                              : `text-[#1c1c1c] ${paragraphIndent ? "indent-[2em]" : ""}`
                          }`}
                        >
                          <MathText
                            text={blk.zh}
                            blockId={blk.id}
                            lang="zh"
                            highlights={blockHighlights.filter((h) => h.lang === "zh")}
                            anchors={blockAnchors.filter((a) => a.lang === "zh")}
                            activeAnchorId={activeAnchorId}
                            onClickAnchor={handleClickAnchor}
                            onClickCitation={handleClickCitation}
                            onClickFigureRef={handleClickFigureRef}
                          />
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>

              {/* Structured References Appendix */}
              {data.references_list.length > 0 && (
                <section className="pt-10 border-t border-[#1c1c1c]/20 space-y-4">
                  <div className="section-label">References / 参考文献</div>
                  <ol className="space-y-2.5 text-[13px] leading-[1.6] text-[#6b7280]">
                    {data.references_list.map((ref) => (
                      <li key={ref.index} className="flex gap-2.5">
                        <span className="text-[#816d70] font-medium shrink-0">
                          {ref.label}
                        </span>
                        <span>{ref.raw}</span>
                      </li>
                    ))}
                  </ol>
                </section>
              )}
            </article>
          )}

          {/* Selection Floating Toolbar (document-anchored: scrolls with selected text) */}
          {selection && (
            <div
              data-floating-ui="true"
              onMouseUp={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              style={{ top: `${selection.rectTop}px`, left: `${selection.rectLeft}px` }}
              className="absolute z-40 bg-[#1c1c1c] text-[#f9f8f6] border border-[#1c1c1c] px-1.5 py-1 flex flex-col gap-2 w-max max-w-[340px]"
            >
              <div className="flex items-center gap-0.5 text-[12px]">
                <button
                  type="button"
                  onClick={() => handleAnchorQA("explain")}
                  className="px-2.5 py-1.5 hover:bg-[#f9f8f6] hover:text-[#1c1c1c] transition-colors flex items-center gap-1"
                >
                  <Sparkles className="w-3.5 h-3.5" />
                  AI 解释
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setAskSubMode((v) => !v);
                    setHighlightSubMode(false);
                  }}
                  className="px-2.5 py-1.5 hover:bg-[#f9f8f6] hover:text-[#1c1c1c] transition-colors flex items-center gap-1"
                >
                  <MessageSquarePlus className="w-3.5 h-3.5" />
                  问问 AI
                </button>
                <button
                  type="button"
                  onClick={handleInlineTranslate}
                  className="px-2.5 py-1.5 hover:bg-[#f9f8f6] hover:text-[#1c1c1c] transition-colors flex items-center gap-1"
                >
                  <Languages className="w-3.5 h-3.5" />
                  翻译
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setHighlightSubMode((v) => !v);
                    setAskSubMode(false);
                  }}
                  className="px-2.5 py-1.5 hover:bg-[#f9f8f6] hover:text-[#1c1c1c] transition-colors"
                >
                  高亮
                </button>
                <button
                  type="button"
                  onClick={clearSelectionUI}
                  aria-label="关闭划词工具栏"
                  className="px-1.5 py-1.5 opacity-75 hover:opacity-100"
                >
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>

              {askSubMode && (
                <div className="bg-[#f9f8f6] text-[#1c1c1c] p-2 space-y-2 border-t border-[#1c1c1c]">
                  <input
                    type="text"
                    value={askSubInput}
                    onChange={(e) => setAskSubInput(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && askSubInput.trim()) {
                        handleAnchorQA("ask", askSubInput.trim());
                      }
                    }}
                    placeholder="输入针对该段选区的问题..."
                    className="w-full border border-[#1c1c1c]/30 px-2.5 py-1.5 text-[12px]"
                    autoFocus
                  />
                  <button
                    type="button"
                    disabled={!askSubInput.trim()}
                    onClick={() => handleAnchorQA("ask", askSubInput.trim())}
                    className="w-full py-1.5 bg-[#1c1c1c] text-[#f9f8f6] text-[11px] uppercase tracking-[0.16em]"
                  >
                    发送并保存为锚点问答
                  </button>
                </div>
              )}

              {highlightSubMode && (
                <div className="bg-[#f9f8f6] text-[#1c1c1c] p-2.5 space-y-2 border-t border-[#1c1c1c]">
                  <input
                    type="text"
                    value={highlightNoteInput}
                    onChange={(e) => setHighlightNoteInput(e.target.value)}
                    placeholder="可选：添加批注..."
                    className="w-full border border-[#1c1c1c]/30 px-2 py-1 text-[12px]"
                  />
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-[11px] text-[#6b7280]">选择高亮色：</span>
                    <div className="flex gap-2">
                      {[
                        { id: "mauve", bg: "bg-[#816d70]" },
                        { id: "amber", bg: "bg-[#caa560]" },
                        { id: "sage", bg: "bg-[#789480]" },
                        { id: "slate", bg: "bg-[#6b7280]" },
                      ].map((c) => (
                        <button
                          key={c.id}
                          type="button"
                          onClick={() =>
                            handleCreateHighlight(c.id as "mauve" | "amber" | "sage" | "slate")
                          }
                          aria-label={`高亮颜色 ${c.id}`}
                          className={`w-6 h-6 border border-[#1c1c1c] ${c.bg}`}
                        />
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Inline Translation Result Card (document-anchored: scrolls with selected text) */}
          {selection && inlineTranslateResult && (
            <div
              data-floating-ui="true"
              onMouseUp={(e) => e.stopPropagation()}
              onTouchEnd={(e) => e.stopPropagation()}
              style={{
                top: `${selection.rectBottom}px`,
                left: `${selection.rectLeft}px`,
              }}
              className="absolute z-40 w-[340px] max-w-[calc(100%-24px)] bg-[#f9f8f6] border border-[#1c1c1c] p-3.5 space-y-2.5 text-[13px]"
            >
              <div className="flex items-center justify-between border-b border-[#1c1c1c]/10 pb-1.5">
                <span className="text-[11px] uppercase tracking-[0.16em] text-[#816d70]">
                  上下文精准译文
                </span>
                <button type="button" onClick={() => setInlineTranslateResult(null)}>
                  <X className="w-3.5 h-3.5" />
                </button>
              </div>
              {inlineTranslateResult.loading ? (
                <div className="py-3 text-[12px] text-[#6b7280] flex items-center gap-2">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  正在结合论文上下文翻译...
                </div>
              ) : (
                <>
                  <div className="leading-[1.65] text-[#1c1c1c]">
                    <MarkdownMath content={inlineTranslateResult.translation} />
                  </div>
                  <button
                    type="button"
                    disabled={inlineTranslateResult.saved}
                    onClick={handleSaveInlineTranslation}
                    className="btn-editorial-outline w-full py-1.5 text-[11px]"
                  >
                    {inlineTranslateResult.saved ? "已更新保存至该段译文" : "一键更新保存为该段译文"}
                  </button>
                </>
              )}
            </div>
          )}
        </div>

        {/* Desktop Right AI Sidebar */}
        {sidebarOpen && (
          <aside className="hidden lg:block w-[400px] shrink-0 border-l border-[#1c1c1c]/15 sticky top-14 h-[calc(100vh-3.5rem)]">
            {sidebarPanel}
          </aside>
        )}
      </div>

      {/* Mobile Floating AI Companion Trigger & Bottom Drawer */}
      <button
        type="button"
        onClick={() => setMobileDrawerOpen(true)}
        className="lg:hidden fixed right-4 bottom-6 z-30 btn-editorial py-3 px-4"
      >
        <Bot className="w-4 h-4" />
        AI 伴读
      </button>

      {mobileDrawerOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex flex-col justify-end">
          <div
            className="flex-1 bg-[#1c1c1c]/35"
            onClick={() => setMobileDrawerOpen(false)}
          />
          <div className="h-[74dvh] bg-[#f9f8f6] border-t border-[#1c1c1c] flex flex-col">
            <div className="flex items-center justify-between px-4 py-2 border-b border-[#1c1c1c]/15">
              <span className="text-[11px] uppercase tracking-[0.2em] text-[#6b7280]">
                AI 学术伴读面板
              </span>
              <button
                type="button"
                onClick={() => setMobileDrawerOpen(false)}
                className="p-1"
              >
                <ChevronDown className="w-5 h-5" />
              </button>
            </div>
            <div className="flex-1 min-h-0">{sidebarPanel}</div>
          </div>
        </div>
      )}

      {/* In-Place Citation Reference Popover */}
      {activeRefPopover && (
        <div
          data-floating-ui="true"
          style={{
            top: `${activeRefPopover.top}px`,
            left: `${activeRefPopover.left}px`,
          }}
          className="fixed z-50 w-[340px] bg-[#f9f8f6] border border-[#1c1c1c] p-4 space-y-2 text-[12px]"
        >
          <div className="flex items-center justify-between border-b border-[#1c1c1c]/15 pb-1.5">
            <span className="uppercase tracking-[0.18em] text-[#816d70] font-medium">
              参考文献 {activeRefPopover.refItem.label}
            </span>
            <button type="button" onClick={() => setActiveRefPopover(null)}>
              <X className="w-3.5 h-3.5" />
            </button>
          </div>
          <div className="font-serif text-[14px] text-[#1c1c1c] leading-snug">
            {activeRefPopover.refItem.title}
          </div>
          <div className="text-[#6b7280]">
            {activeRefPopover.refItem.authors}{" "}
            {activeRefPopover.refItem.year ? `(${activeRefPopover.refItem.year})` : ""}
          </div>
          <div className="text-[11px] text-[#6b7280]/90 pt-1 border-t border-[#1c1c1c]/10">
            {activeRefPopover.refItem.raw}
          </div>
        </div>
      )}

      {/* In-Place Figure / Table Lightbox Modal */}
      {activeFigureModal && (
        <div
          onClick={() => setActiveFigureModal(null)}
          className="fixed inset-0 z-50 bg-[#1c1c1c]/45 flex items-center justify-center p-4 md:p-10"
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-3xl max-h-[88dvh] overflow-y-auto bg-[#f9f8f6] border border-[#1c1c1c] p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-[#1c1c1c]/15 pb-3">
              <span className="section-label">
                {activeFigureModal.figure_label || "Figure / Table"} · Page{" "}
                {activeFigureModal.page_num}
              </span>
              <button
                type="button"
                onClick={() => setActiveFigureModal(null)}
                className="p-1.5 border border-[#1c1c1c]/20"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            {activeFigureModal.figure_url && (
              <div className="bg-white border border-[#1c1c1c]/15 p-3 flex justify-center">
                <img
                  src={withAuthTokenUrl(activeFigureModal.figure_url)}
                  alt={activeFigureModal.figure_label || "Figure"}
                  className="max-h-[55dvh] object-contain"
                />
              </div>
            )}
            <div className="space-y-2 text-[13px] leading-[1.7]">
              {activeFigureModal.caption_en && (
                <p className="text-[#6b7280]">{activeFigureModal.caption_en}</p>
              )}
              {activeFigureModal.caption_zh && (
                <p className="text-[#1c1c1c]">{activeFigureModal.caption_zh}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Multi-Paper Synthesis Dialog inside Reader */}
      <dialog
        ref={synthDialogRef}
        aria-labelledby="reader-synth-title"
        // @ts-expect-error closedby progressive enhancement
        closedby="any"
        className="w-[min(94vw,720px)]"
      >
        <div className="p-6 space-y-4 bg-[#f9f8f6] max-h-[85dvh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-[#1c1c1c]/15 pb-3">
            <h2 id="reader-synth-title" className="font-serif text-2xl font-normal">
              多篇文献联合综述
            </h2>
            <button
              type="button"
              onClick={() => synthDialogRef.current?.close()}
              className="p-1.5 border border-[#1c1c1c]/20"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="max-h-48 overflow-y-auto border border-[#1c1c1c]/15 p-3 space-y-1.5">
            {allPapers.map((p) => (
              <label key={p.id} className="flex items-center gap-2 text-[13px] cursor-pointer">
                <input
                  type="checkbox"
                  checked={synthIds.includes(p.id)}
                  onChange={(e) =>
                    setSynthIds((prev) =>
                      e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)
                    )
                  }
                />
                <span className="truncate">{p.title_zh || p.title}</span>
              </label>
            ))}
          </div>

          <button
            type="button"
            disabled={synthIds.length < 2 || synthLoading}
            onClick={runSynthesisInReader}
            className="btn-editorial"
          >
            {synthLoading ? "正在生成综述..." : `生成综述报告 (已选 ${synthIds.length} 篇)`}
          </button>

          {synthResult && (
            <div className="text-[14px] leading-[1.7] bg-[#f3f1ed] p-4 border border-[#1c1c1c]/10">
              <MarkdownMath content={synthResult} />
            </div>
          )}
        </div>
      </dialog>
    </div>
  );
}
