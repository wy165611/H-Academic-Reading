"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  BookOpen,
  ChevronDown,
  FileText,
  Folder as FolderIcon,
  FolderPlus,
  LayoutGrid,
  List as ListIcon,
  LogOut,
  Menu,
  MoreHorizontal,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import {
  apiFetch,
  FolderItem,
  FolderTreeResponse,
  PaperItem,
  setStoredToken,
  useEditorialDialog,
  withAuthTokenUrl,
} from "@/lib/api";
import SettingsModal from "@/components/SettingsModal";

interface LibraryViewProps {
  username: string;
  onLogout: () => void;
}

export default function LibraryView({ username, onLogout }: LibraryViewProps) {
  const [foldersData, setFoldersData] = useState<FolderTreeResponse>({
    total_count: 0,
    uncategorized_count: 0,
    folders: [],
  });
  const [papers, setPapers] = useState<PaperItem[]>([]);
  const [loading, setLoading] = useState(true);

  const [selectedFolder, setSelectedFolder] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [filterTier, setFilterTier] = useState("all");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState<"created_at" | "year" | "title">("created_at");
  const [viewMode, setViewMode] = useState<"grid" | "list">("grid");
  const [mobileSidebarOpen, setMobileSidebarOpen] = useState(false);

  // Drag & drop overlay
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const dragCounter = useRef(0);
  const [uploadingBanner, setUploadingBanner] = useState<string | null>(null);

  // Modals
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [addModalOpen, setAddModalOpen] = useState(false);
  const [addTab, setAddTab] = useState<"file" | "url">("file");
  const [urlInput, setUrlInput] = useState("");
  const [uploadTargetFolder, setUploadTargetFolder] = useState<string>("");
  const [addSubmitting, setAddSubmitting] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Folder inline creation/rename
  const [newFolderOpen, setNewFolderOpen] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [renamingFolder, setRenamingFolder] = useState<FolderItem | null>(null);
  const [renameFolderInput, setRenameFolderInput] = useState("");

  // Card action menu & edit metadata modal
  const [openMenuPaperId, setOpenMenuPaperId] = useState<string | null>(null);
  const [editingPaper, setEditingPaper] = useState<PaperItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editTitleZh, setEditTitleZh] = useState("");
  const [editAuthors, setEditAuthors] = useState("");
  const [editVenue, setEditVenue] = useState("");
  const [editYear, setEditYear] = useState("");
  const [editTiers, setEditTiers] = useState("");
  const [editFolderId, setEditFolderId] = useState("");

  // Multi-paper synthesis modal
  const [synthOpen, setSynthOpen] = useState(false);
  const [synthSelectedIds, setSynthSelectedIds] = useState<string[]>([]);
  const [synthQuestion, setSynthQuestion] = useState("");
  const [synthLoading, setSynthLoading] = useState(false);
  const [synthResult, setSynthResult] = useState<string | null>(null);
  const [synthError, setSynthError] = useState<string | null>(null);

  const addDialogRef = useEditorialDialog(addModalOpen, () => setAddModalOpen(false));
  const editDialogRef = useEditorialDialog(Boolean(editingPaper), () => setEditingPaper(null));
  const synthDialogRef = useEditorialDialog(synthOpen, () => setSynthOpen(false));

  const fetchAll = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      params.set("folder_id", selectedFolder);
      if (searchQuery.trim()) params.set("q", searchQuery.trim());
      if (filterTier !== "all") params.set("tier", filterTier);
      if (filterStatus !== "all") params.set("status", filterStatus);
      params.set("sort", sortBy);

      const [fRes, pRes] = await Promise.all([
        apiFetch<FolderTreeResponse>("/api/folders"),
        apiFetch<PaperItem[]>(`/api/papers?${params.toString()}`),
      ]);
      setFoldersData(fRes);
      setPapers(pRes);
    } catch (err) {
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [selectedFolder, searchQuery, filterTier, filterStatus, sortBy]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  // Auto-sync across Desktop & iPhone/iPad PWA whenever the tab/app regains focus
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        fetchAll();
      }
    };
    window.addEventListener("focus", fetchAll);
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.removeEventListener("focus", fetchAll);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [fetchAll]);

  // Poll every 3s while any paper is queued or processing
  const hasActiveJobs = useMemo(
    () => papers.some((p) => p.status === "queued" || p.status === "processing"),
    [papers]
  );

  useEffect(() => {
    if (!hasActiveJobs) return;
    const timer = setInterval(() => {
      fetchAll();
    }, 3000);
    return () => clearInterval(timer);
  }, [hasActiveJobs, fetchAll]);

  const handleUploadFiles = useCallback(
    async (fileList: FileList | File[], folderOverride?: string) => {
      const pdfs = Array.from(fileList).filter((f) =>
        f.name.toLowerCase().endsWith(".pdf")
      );
      if (pdfs.length === 0) {
        setAddError("请选择或拖入 .pdf 格式的学术文献");
        return;
      }

      setUploadingBanner(`正在上传 ${pdfs.length} 篇 PDF 文献...`);
      setAddError(null);
      setAddSubmitting(true);
      try {
        const fd = new FormData();
        pdfs.forEach((f) => fd.append("files", f));
        const targetFolder =
          folderOverride !== undefined
            ? folderOverride
            : selectedFolder !== "all" && selectedFolder !== "uncategorized"
            ? selectedFolder
            : "";
        if (targetFolder) fd.append("folder_id", targetFolder);

        await apiFetch<PaperItem[]>("/api/papers/upload", {
          method: "POST",
          body: fd,
        });
        setAddModalOpen(false);
        await fetchAll();
      } catch (err) {
        setAddError(err instanceof Error ? err.message : "上传失败");
      } finally {
        setAddSubmitting(false);
        setUploadingBanner(null);
      }
    },
    [selectedFolder, fetchAll]
  );

  // Global window drag-and-drop PDF upload
  useEffect(() => {
    const onDragEnter = (e: DragEvent) => {
      e.preventDefault();
      if (e.dataTransfer?.types?.includes("Files")) {
        dragCounter.current += 1;
        setIsDraggingOver(true);
      }
    };
    const onDragOver = (e: DragEvent) => {
      e.preventDefault();
    };
    const onDragLeave = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = Math.max(0, dragCounter.current - 1);
      if (dragCounter.current === 0) {
        setIsDraggingOver(false);
      }
    };
    const onDrop = (e: DragEvent) => {
      e.preventDefault();
      dragCounter.current = 0;
      setIsDraggingOver(false);
      if (e.dataTransfer?.files && e.dataTransfer.files.length > 0) {
        handleUploadFiles(e.dataTransfer.files);
      }
    };

    window.addEventListener("dragenter", onDragEnter);
    window.addEventListener("dragover", onDragOver);
    window.addEventListener("dragleave", onDragLeave);
    window.addEventListener("drop", onDrop);
    return () => {
      window.removeEventListener("dragenter", onDragEnter);
      window.removeEventListener("dragover", onDragOver);
      window.removeEventListener("dragleave", onDragLeave);
      window.removeEventListener("drop", onDrop);
    };
  }, [handleUploadFiles]);

  // Close card menu on outside click
  useEffect(() => {
    if (!openMenuPaperId) return;
    const closeMenu = () => setOpenMenuPaperId(null);
    window.addEventListener("click", closeMenu);
    return () => window.removeEventListener("click", closeMenu);
  }, [openMenuPaperId]);

  async function handleImportUrl() {
    if (!urlInput.trim()) return;
    setAddError(null);
    setAddSubmitting(true);
    try {
      await apiFetch<PaperItem>("/api/papers/url", {
        method: "POST",
        body: JSON.stringify({
          url: urlInput.trim(),
          folder_id: uploadTargetFolder || null,
        }),
      });
      setUrlInput("");
      setAddModalOpen(false);
      await fetchAll();
    } catch (err) {
      setAddError(err instanceof Error ? err.message : "抓取失败");
    } finally {
      setAddSubmitting(false);
    }
  }

  async function handleCreateFolder() {
    if (!newFolderName.trim()) return;
    await apiFetch("/api/folders", {
      method: "POST",
      body: JSON.stringify({ name: newFolderName.trim() }),
    });
    setNewFolderName("");
    setNewFolderOpen(false);
    await fetchAll();
  }

  async function handleRenameFolder(folder: FolderItem) {
    if (!renameFolderInput.trim()) {
      setRenamingFolder(null);
      return;
    }
    await apiFetch(`/api/folders/${folder.id}`, {
      method: "PUT",
      body: JSON.stringify({ name: renameFolderInput.trim() }),
    });
    setRenamingFolder(null);
    await fetchAll();
  }

  async function handleDeleteFolder(folder: FolderItem) {
    if (!confirm(`确定删除文件夹「${folder.name}」吗？其中的文献将保留在「未分类」中。`)) {
      return;
    }
    await apiFetch(`/api/folders/${folder.id}`, { method: "DELETE" });
    if (selectedFolder === folder.id) setSelectedFolder("all");
    await fetchAll();
  }

  function openEditMetadata(p: PaperItem) {
    setEditingPaper(p);
    setEditTitle(p.title);
    setEditTitleZh(p.title_zh || "");
    setEditAuthors((p.authors || []).join(", "));
    setEditVenue(p.venue || "");
    setEditYear(p.year ? String(p.year) : "");
    setEditTiers((p.journal_tier || []).join(", "));
    setEditFolderId(p.folder_id || "");
    setOpenMenuPaperId(null);
  }

  async function handleSaveMetadata() {
    if (!editingPaper) return;
    await apiFetch(`/api/papers/${editingPaper.id}`, {
      method: "PUT",
      body: JSON.stringify({
        title: editTitle.trim(),
        title_zh: editTitleZh.trim(),
        authors: editAuthors
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        venue: editVenue.trim(),
        year: editYear ? parseInt(editYear, 10) : null,
        journal_tier: editTiers
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        folder_id: editFolderId || null,
        clear_folder: !editFolderId,
      }),
    });
    setEditingPaper(null);
    await fetchAll();
  }

  async function handleReparse(paperId: string) {
    setOpenMenuPaperId(null);
    await apiFetch(`/api/papers/${paperId}/reparse`, { method: "POST" });
    await fetchAll();
  }

  async function handleDeletePaper(p: PaperItem) {
    setOpenMenuPaperId(null);
    if (!confirm(`确定永久删除文献《${p.title_zh || p.title}》吗？`)) return;
    await apiFetch(`/api/papers/${p.id}`, { method: "DELETE" });
    await fetchAll();
  }

  async function handleRunSynthesis() {
    if (synthSelectedIds.length < 2) {
      setSynthError("请至少勾选 2 篇已解析文献");
      return;
    }
    setSynthError(null);
    setSynthLoading(true);
    try {
      const res = await apiFetch<{
        thread_id: string;
        messages: { role: string; content: string }[];
      }>("/api/synthesis", {
        method: "POST",
        body: JSON.stringify({
          paper_ids: synthSelectedIds,
          question: synthQuestion.trim() || undefined,
        }),
      });
      const last = res.messages[res.messages.length - 1];
      setSynthResult(last?.content || "");
    } catch (err) {
      setSynthError(err instanceof Error ? err.message : "生成综述失败");
    } finally {
      setSynthLoading(false);
    }
  }

  async function handleLogout() {
    try {
      await apiFetch("/api/auth/logout", { method: "POST" });
    } catch {
      // ignore
    }
    setStoredToken(null);
    onLogout();
  }

  const formatAuthors = (authors: string[]) => {
    if (!authors || authors.length === 0) return "未知作者";
    if (authors.length === 1) return authors[0];
    return `${authors[0]} 等 ${authors.length} 人`;
  };

  const sidebarContent = (
    <div className="flex flex-col h-full justify-between p-6 bg-[#f9f8f6]">
      <div className="space-y-8">
        <div className="flex items-center justify-between border-b border-[#1c1c1c]/15 pb-4">
          <div>
            <div className="font-serif text-xl tracking-tight">H文献大师</div>
            <div className="text-[11px] uppercase tracking-[0.2em] text-[#6b7280] mt-0.5">
              Archive · {username}
            </div>
          </div>
          <button
            type="button"
            onClick={() => setMobileSidebarOpen(false)}
            className="lg:hidden p-1.5 border border-[#1c1c1c]/20"
            aria-label="关闭侧栏"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Main Library Entries */}
        <nav className="space-y-1" aria-label="文献库导航">
          <div className="section-label mb-3">文献库</div>
          <button
            type="button"
            onClick={() => {
              setSelectedFolder("all");
              setMobileSidebarOpen(false);
            }}
            className={`w-full flex items-center justify-between px-3 py-2.5 text-[13px] border transition-colors ${
              selectedFolder === "all"
                ? "border-[#1c1c1c] bg-[#1c1c1c] text-[#f9f8f6]"
                : "border-transparent hover:border-[#1c1c1c]/20"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <BookOpen className="w-4 h-4" />
              全部文献
            </span>
            <span className="text-[12px] opacity-75">{foldersData.total_count}</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setSelectedFolder("uncategorized");
              setMobileSidebarOpen(false);
            }}
            className={`w-full flex items-center justify-between px-3 py-2.5 text-[13px] border transition-colors ${
              selectedFolder === "uncategorized"
                ? "border-[#1c1c1c] bg-[#1c1c1c] text-[#f9f8f6]"
                : "border-transparent hover:border-[#1c1c1c]/20"
            }`}
          >
            <span className="flex items-center gap-2.5">
              <FileText className="w-4 h-4" />
              未分类
            </span>
            <span className="text-[12px] opacity-75">
              {foldersData.uncategorized_count}
            </span>
          </button>
        </nav>

        {/* Folders Tree */}
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <span className="section-label">文件夹</span>
            <button
              type="button"
              onClick={() => setNewFolderOpen((v) => !v)}
              aria-label="新建文件夹"
              className="p-1 border border-[#1c1c1c]/20 hover:bg-[#1c1c1c] hover:text-[#f9f8f6] transition-colors"
            >
              <FolderPlus className="w-3.5 h-3.5" />
            </button>
          </div>

          {newFolderOpen && (
            <div className="flex gap-1.5 pt-1">
              <input
                type="text"
                value={newFolderName}
                onChange={(e) => setNewFolderName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && handleCreateFolder()}
                placeholder="文件夹名称..."
                className="flex-1 min-w-0 bg-[#f9f8f6] border border-[#1c1c1c]/30 px-2.5 py-1.5 text-[12px]"
                autoFocus
              />
              <button
                type="button"
                onClick={handleCreateFolder}
                className="px-2.5 py-1.5 bg-[#1c1c1c] text-[#f9f8f6] text-[11px] uppercase tracking-[0.15em]"
              >
                建
              </button>
            </div>
          )}

          <div className="space-y-1 max-h-[38vh] overflow-y-auto pr-1">
            {foldersData.folders.map((folder) => {
              const isActive = selectedFolder === folder.id;
              const isRenaming = renamingFolder?.id === folder.id;

              return (
                <div key={folder.id} className="group flex items-center gap-1">
                  {isRenaming ? (
                    <input
                      type="text"
                      value={renameFolderInput}
                      onChange={(e) => setRenameFolderInput(e.target.value)}
                      onBlur={() => handleRenameFolder(folder)}
                      onKeyDown={(e) => e.key === "Enter" && handleRenameFolder(folder)}
                      className="flex-1 bg-[#f9f8f6] border border-[#1c1c1c] px-2 py-1.5 text-[12px]"
                      autoFocus
                    />
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedFolder(folder.id);
                        setMobileSidebarOpen(false);
                      }}
                      className={`flex-1 min-w-0 flex items-center justify-between px-3 py-2 text-[13px] border transition-colors ${
                        isActive
                          ? "border-[#1c1c1c] bg-[#1c1c1c] text-[#f9f8f6]"
                          : "border-transparent hover:border-[#1c1c1c]/20"
                      }`}
                    >
                      <span className="flex items-center gap-2 truncate">
                        <FolderIcon className="w-3.5 h-3.5 shrink-0" />
                        <span className="truncate">{folder.name}</span>
                      </span>
                      <span className="text-[11px] opacity-70 ml-2">
                        {folder.paper_count}
                      </span>
                    </button>
                  )}
                  <div className="hidden group-hover:flex items-center gap-0.5">
                    <button
                      type="button"
                      onClick={() => {
                        setRenamingFolder(folder);
                        setRenameFolderInput(folder.name);
                      }}
                      aria-label="重命名文件夹"
                      className="p-1 text-[#6b7280] hover:text-[#1c1c1c]"
                    >
                      <Pencil className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteFolder(folder)}
                      aria-label="删除文件夹"
                      className="p-1 text-[#6b7280] hover:text-[#816d70]"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Actions */}
      <div className="space-y-2 pt-6 border-t border-[#1c1c1c]/10">
        <button
          type="button"
          onClick={() => {
            setSynthResult(null);
            setSynthError(null);
            setSynthOpen(true);
            setMobileSidebarOpen(false);
          }}
          className="w-full btn-editorial-outline justify-start text-[11px]"
        >
          <Sparkles className="w-3.5 h-3.5 text-[#816d70]" />
          多篇文献综述报告
        </button>
        <button
          type="button"
          onClick={handleLogout}
          className="w-full flex items-center gap-2 px-3 py-2 text-[12px] text-[#6b7280] hover:text-[#1c1c1c] transition-colors"
        >
          <LogOut className="w-3.5 h-3.5" />
          退出当前账号
        </button>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-[#f9f8f6] text-[#1c1c1c] flex pwa-safe-top pwa-safe-bottom">
      {/* Desktop Left Sidebar */}
      <aside className="hidden lg:block w-[260px] shrink-0 border-r border-[#1c1c1c]/10 sticky top-0 h-screen">
        {sidebarContent}
      </aside>

      {/* Mobile Drawer Sidebar */}
      {mobileSidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden flex">
          <div className="w-[270px] h-full border-r border-[#1c1c1c] bg-[#f9f8f6] z-10">
            {sidebarContent}
          </div>
          <div
            className="flex-1 bg-[#1c1c1c]/35"
            onClick={() => setMobileSidebarOpen(false)}
          />
        </div>
      )}

      {/* Main Content */}
      <div className="flex-1 min-w-0 flex flex-col">
        <div className="w-full max-w-[1200px] mx-auto px-5 md:px-10 py-6 md:py-10 space-y-8">
          {/* Top Toolbar */}
          <header className="flex flex-col md:flex-row md:items-end justify-between gap-6 border-b border-[#1c1c1c]/10 pb-6">
            <div className="flex items-start gap-3">
              <button
                type="button"
                onClick={() => setMobileSidebarOpen(true)}
                className="lg:hidden mt-1 p-2 border border-[#1c1c1c]/20"
                aria-label="打开文献库目录"
              >
                <Menu className="w-4 h-4" />
              </button>
              <div>
                <div className="section-label mb-2">Research Library</div>
                <div className="flex items-baseline gap-4">
                  <h1 className="font-serif text-[32px] md:text-[42px] leading-[1.1] tracking-[-0.02em] font-normal">
                    文献库
                  </h1>
                  <span className="text-[12px] uppercase tracking-[0.18em] text-[#6b7280]">
                    共 {papers.length} 篇文章
                  </span>
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => {
                  setAddError(null);
                  setUploadTargetFolder(
                    selectedFolder !== "all" && selectedFolder !== "uncategorized"
                      ? selectedFolder
                      : ""
                  );
                  setAddModalOpen(true);
                }}
                className="btn-editorial h-9 py-0 px-4 text-[12px] tracking-[0.14em]"
              >
                <Plus className="w-3.5 h-3.5" />
                添加文章
              </button>

              {/* Filter Tier & Status */}
              <div className="relative inline-flex items-center">
                <select
                  aria-label="按期刊分区筛选"
                  value={filterTier}
                  onChange={(e) => setFilterTier(e.target.value)}
                  className="appearance-none bg-[#f9f8f6] border border-[#1c1c1c]/25 hover:border-[#1c1c1c]/50 focus:border-[#1c1c1c] focus:outline-none h-9 pl-3 pr-8 text-[12px] text-[#1c1c1c] cursor-pointer transition-colors"
                >
                  <option value="all">全部分区</option>
                  <option value="中科院1区">中科院1区</option>
                  <option value="JCR Q1">JCR Q1</option>
                  <option value="CCF-A">CCF-A</option>
                  <option value="arXiv">arXiv</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[#6b7280] pointer-events-none absolute right-2.5" />
              </div>

              <div className="relative inline-flex items-center">
                <select
                  aria-label="按解析状态筛选"
                  value={filterStatus}
                  onChange={(e) => setFilterStatus(e.target.value)}
                  className="appearance-none bg-[#f9f8f6] border border-[#1c1c1c]/25 hover:border-[#1c1c1c]/50 focus:border-[#1c1c1c] focus:outline-none h-9 pl-3 pr-8 text-[12px] text-[#1c1c1c] cursor-pointer transition-colors"
                >
                  <option value="all">全部状态</option>
                  <option value="ready">已就绪</option>
                  <option value="processing">解析中</option>
                  <option value="failed">解析失败</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[#6b7280] pointer-events-none absolute right-2.5" />
              </div>

              <div className="relative inline-flex items-center">
                <select
                  aria-label="排序方式"
                  value={sortBy}
                  onChange={(e) =>
                    setSortBy(e.target.value as "created_at" | "year" | "title")
                  }
                  className="appearance-none bg-[#f9f8f6] border border-[#1c1c1c]/25 hover:border-[#1c1c1c]/50 focus:border-[#1c1c1c] focus:outline-none h-9 pl-3 pr-8 text-[12px] text-[#1c1c1c] cursor-pointer transition-colors"
                >
                  <option value="created_at">按添加时间</option>
                  <option value="year">按发表年份</option>
                  <option value="title">按标题排序</option>
                </select>
                <ChevronDown className="w-3.5 h-3.5 text-[#6b7280] pointer-events-none absolute right-2.5" />
              </div>

              <div className="inline-flex h-9 border border-[#1c1c1c]/25">
                <button
                  type="button"
                  onClick={() => setViewMode("grid")}
                  aria-label="卡片网格视图"
                  className={`w-9 h-full inline-flex items-center justify-center transition-colors ${
                    viewMode === "grid" ? "bg-[#1c1c1c] text-[#f9f8f6]" : "bg-[#f9f8f6] hover:bg-[#1c1c1c]/5"
                  }`}
                >
                  <LayoutGrid className="w-3.5 h-3.5" />
                </button>
                <button
                  type="button"
                  onClick={() => setViewMode("list")}
                  aria-label="紧凑列表视图"
                  className={`w-9 h-full inline-flex items-center justify-center border-l border-[#1c1c1c]/25 transition-colors ${
                    viewMode === "list" ? "bg-[#1c1c1c] text-[#f9f8f6]" : "bg-[#f9f8f6] hover:bg-[#1c1c1c]/5"
                  }`}
                >
                  <ListIcon className="w-3.5 h-3.5" />
                </button>
              </div>

              <button
                type="button"
                onClick={() => setSettingsOpen(true)}
                className="btn-editorial-outline h-9 py-0 px-3.5 text-[12px] tracking-[0.14em]"
              >
                <Settings className="w-3.5 h-3.5" />
                设置
              </button>
            </div>
          </header>

          {/* Search Bar */}
          <div className="relative">
            <Search className="w-4 h-4 text-[#6b7280] absolute left-4 top-1/2 -translate-y-1/2 pointer-events-none" />
            <input
              type="search"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="尝试输入标题、作者或摘要进行搜索..."
              className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/20 pl-11 pr-4 py-3 text-[14px] placeholder:text-[#6b7280] focus:border-[#1c1c1c] focus:outline-none"
            />
          </div>

          {uploadingBanner && (
            <div className="border border-[#1c1c1c] px-4 py-3 text-[13px] flex items-center justify-between">
              <span>{uploadingBanner}</span>
            </div>
          )}

          {/* Papers List / Grid */}
          {loading ? (
            <div className="py-24 text-center text-[13px] uppercase tracking-[0.2em] text-[#6b7280]">
              正在同步云端文献库...
            </div>
          ) : papers.length === 0 ? (
            <div className="border border-[#1c1c1c]/15 py-20 px-6 text-center space-y-5">
              <div className="font-serif text-2xl">文献库暂无匹配文章</div>
              <p className="text-[14px] text-[#6b7280] max-w-md mx-auto leading-[1.7]">
                直接将电脑中的学术 PDF 拖入当前页面任意位置，或点击下方按钮上传与粘贴 arXiv 链接。
              </p>
              <button
                type="button"
                onClick={() => setAddModalOpen(true)}
                className="btn-editorial"
              >
                <Plus className="w-4 h-4" />
                导入第一篇文献
              </button>
            </div>
          ) : viewMode === "grid" ? (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-x-8 gap-y-12">
              {papers.map((p) => {
                const isMenuOpen = openMenuPaperId === p.id;
                return (
                  <article key={p.id} className="hairline-card flex flex-col justify-between relative group">
                    <div>
                      {/* Top row: Meta + Action Menu */}
                      <div className="flex items-start justify-between gap-2 mb-4">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="text-[11px] uppercase tracking-[0.18em] text-[#6b7280]">
                            {p.year || "N/A"} {p.venue ? `· ${p.venue}` : ""}
                          </span>
                          {(p.journal_tier || []).map((tier) => (
                            <span
                              key={tier}
                              className="px-1.5 py-0.5 text-[10px] uppercase tracking-[0.12em] border border-[#816d70] text-[#816d70]"
                            >
                              {tier}
                            </span>
                          ))}
                        </div>

                        <div className="relative">
                          <button
                            type="button"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuPaperId(isMenuOpen ? null : p.id);
                            }}
                            aria-label="文献操作菜单"
                            className="p-1 text-[#6b7280] hover:text-[#1c1c1c]"
                          >
                            <MoreHorizontal className="w-4 h-4" />
                          </button>

                          {isMenuOpen && (
                            <div
                              onClick={(e) => e.stopPropagation()}
                              className="absolute right-0 top-7 z-30 w-44 bg-[#f9f8f6] border border-[#1c1c1c] py-1 text-[12px]"
                            >
                              <button
                                type="button"
                                onClick={() => openEditMetadata(p)}
                                className="w-full text-left px-3 py-2 hover:bg-[#1c1c1c] hover:text-[#f9f8f6]"
                              >
                                编辑元数据 / 移动文件夹
                              </button>
                              <button
                                type="button"
                                onClick={() => handleReparse(p.id)}
                                className="w-full text-left px-3 py-2 hover:bg-[#1c1c1c] hover:text-[#f9f8f6]"
                              >
                                重新 AI 解析
                              </button>
                              <button
                                type="button"
                                onClick={() => handleDeletePaper(p)}
                                className="w-full text-left px-3 py-2 text-[#816d70] hover:bg-[#816d70] hover:text-[#f9f8f6]"
                              >
                                删除文献
                              </button>
                            </div>
                          )}
                        </div>
                      </div>

                      {/* Thumbnail Box */}
                      <Link
                        href={`/paper/${p.id}`}
                        className="block border border-[#1c1c1c]/15 bg-[#f2f0ec] overflow-hidden aspect-[4/3] mb-5"
                      >
                        {p.thumbnail_url ? (
                          <img
                            src={withAuthTokenUrl(p.thumbnail_url)}
                            alt={p.title}
                            className="w-full h-full object-cover object-top hairline-card-img"
                          />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center text-[12px] uppercase tracking-[0.2em] text-[#6b7280]">
                            PDF Preview
                          </div>
                        )}
                      </Link>

                      {/* Titles */}
                      <Link href={`/paper/${p.id}`} className="block space-y-1.5 mb-3">
                        <h2 className="font-serif text-[21px] leading-[1.3] font-normal group-hover:underline decoration-1 underline-offset-4">
                          {p.title_zh || p.title}
                        </h2>
                        {p.title_zh && (
                          <p className="text-[13px] text-[#6b7280] leading-[1.5] line-clamp-2">
                            {p.title}
                          </p>
                        )}
                      </Link>
                    </div>

                    {/* Footer: Authors & Parse Status */}
                    <div className="pt-3 border-t border-[#1c1c1c]/10 space-y-2">
                      <div className="flex items-center justify-between text-[12px] text-[#6b7280]">
                        <span className="truncate pr-2">{formatAuthors(p.authors)}</span>
                        <span className="shrink-0">{p.page_count} 页</span>
                      </div>

                      <div className="flex items-center justify-between gap-2 text-[11px]">
                        <span
                          className={
                            p.status === "failed"
                              ? "text-[#816d70]"
                              : p.status === "ready"
                              ? "text-[#1c1c1c]"
                              : "text-[#6b7280]"
                          }
                        >
                          {p.status === "ready"
                            ? "已就绪 · 点击精读"
                            : `${p.progress}% · ${p.progress_message}`}
                        </span>
                        {p.status === "failed" && (
                          <button
                            type="button"
                            onClick={() => handleReparse(p.id)}
                            className="inline-flex items-center gap-1 underline text-[#1c1c1c]"
                          >
                            <RefreshCw className="w-3 h-3" />
                            重试
                          </button>
                        )}
                      </div>

                      {(p.status === "queued" || p.status === "processing") && (
                        <div className="w-full h-[2px] bg-[#1c1c1c]/10">
                          <div
                            className="h-full bg-[#1c1c1c] transition-all duration-300"
                            style={{ width: `${Math.max(4, p.progress)}%` }}
                          />
                        </div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          ) : (
            /* Compact Hairline List View */
            <div className="divide-y divide-[#1c1c1c]/10 border-t border-b border-[#1c1c1c]/10">
              {papers.map((p) => (
                <div
                  key={p.id}
                  className="py-5 flex flex-col md:flex-row md:items-center justify-between gap-4 hover:bg-[#1c1c1c]/[0.02] px-2 transition-colors"
                >
                  <div className="flex-1 min-w-0 space-y-1">
                    <div className="flex flex-wrap items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-[#6b7280]">
                      <span>{p.year || "—"}</span>
                      {p.venue && <span>· {p.venue}</span>}
                      {(p.journal_tier || []).map((t) => (
                        <span
                          key={t}
                          className="px-1.5 py-0 border border-[#816d70] text-[#816d70]"
                        >
                          {t}
                        </span>
                      ))}
                      <span>· {p.status === "ready" ? "已就绪" : `${p.progress}%`}</span>
                    </div>
                    <Link href={`/paper/${p.id}`} className="block">
                      <h2 className="font-serif text-[20px] leading-[1.3] font-normal hover:underline underline-offset-4">
                        {p.title_zh || p.title}
                      </h2>
                      {p.title_zh && (
                        <p className="text-[13px] text-[#6b7280] truncate">{p.title}</p>
                      )}
                    </Link>
                    <p className="text-[12px] text-[#6b7280]">{formatAuthors(p.authors)}</p>
                  </div>

                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => openEditMetadata(p)}
                      className="link-editorial text-[11px]"
                    >
                      编辑
                    </button>
                    <button
                      type="button"
                      onClick={() => handleReparse(p.id)}
                      className="link-editorial text-[11px]"
                    >
                      重解析
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeletePaper(p)}
                      className="link-editorial text-[11px] text-[#816d70]"
                    >
                      删除
                    </button>
                    <Link href={`/paper/${p.id}`} className="btn-editorial-outline py-1.5 px-3 text-[11px]">
                      阅读
                    </Link>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Global Drag & Drop Overlay */}
      {isDraggingOver && (
        <div className="fixed inset-0 z-50 bg-[#f9f8f6]/92 flex items-center justify-center p-8 pointer-events-none">
          <div className="w-full max-w-xl border border-dashed border-[#1c1c1c] p-14 text-center space-y-4">
            <Upload className="w-8 h-8 mx-auto text-[#1c1c1c]" />
            <div className="font-serif text-3xl">松开鼠标上传 PDF 文献</div>
            <p className="text-[13px] text-[#6b7280]">
              支持多篇 PDF 同时拖拽导入，将自动进入单并发 AI 重排与翻译队列
            </p>
          </div>
        </div>
      )}

      {/* Add Paper Modal */}
      <dialog
        ref={addDialogRef}
        aria-labelledby="add-paper-title"
        // @ts-expect-error closedby progressive enhancement
        closedby="any"
        className="w-[min(92vw,560px)]"
      >
        <div className="p-6 space-y-6 bg-[#f9f8f6]">
          <div className="flex items-center justify-between border-b border-[#1c1c1c]/15 pb-4">
            <h2 id="add-paper-title" className="font-serif text-2xl font-normal">
              添加学术文献
            </h2>
            <button
              type="button"
              onClick={() => addDialogRef.current?.close()}
              className="p-1.5 border border-[#1c1c1c]/20"
              aria-label="关闭添加窗口"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="flex border-b border-[#1c1c1c]/15">
            <button
              type="button"
              onClick={() => setAddTab("file")}
              className={`px-4 py-2.5 text-[12px] uppercase tracking-[0.18em] border-b-2 ${
                addTab === "file"
                  ? "border-[#1c1c1c] text-[#1c1c1c]"
                  : "border-transparent text-[#6b7280]"
              }`}
            >
              本地上传 PDF
            </button>
            <button
              type="button"
              onClick={() => setAddTab("url")}
              className={`px-4 py-2.5 text-[12px] uppercase tracking-[0.18em] border-b-2 ${
                addTab === "url"
                  ? "border-[#1c1c1c] text-[#1c1c1c]"
                  : "border-transparent text-[#6b7280]"
              }`}
            >
              arXiv / PDF 链接抓取
            </button>
          </div>

          <div>
            <label htmlFor="target-folder-sel" className="block text-[12px] text-[#6b7280] mb-1.5">
              存入文件夹（可选）
            </label>
            <select
              id="target-folder-sel"
              value={uploadTargetFolder}
              onChange={(e) => setUploadTargetFolder(e.target.value)}
              className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2.5 text-[13px]"
            >
              <option value="">未分类</option>
              {foldersData.folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          {addTab === "file" ? (
            <div className="space-y-4">
              <input
                ref={fileInputRef}
                type="file"
                accept="application/pdf,.pdf"
                multiple
                className="hidden"
                onChange={(e) => {
                  if (e.target.files?.length) {
                    handleUploadFiles(e.target.files, uploadTargetFolder);
                  }
                }}
              />
              <button
                type="button"
                disabled={addSubmitting}
                onClick={() => fileInputRef.current?.click()}
                className="w-full border border-dashed border-[#1c1c1c]/40 py-12 px-6 text-center hover:border-[#1c1c1c] transition-colors space-y-2"
              >
                <Upload className="w-6 h-6 mx-auto text-[#1c1c1c]" />
                <div className="font-serif text-lg">
                  {addSubmitting ? "正在上传并创建任务..." : "点击选择本地 PDF 文件（支持多选）"}
                </div>
                <div className="text-[12px] text-[#6b7280]">单文件上限 60 MB</div>
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <div>
                <label htmlFor="pdf-url-input" className="block text-[12px] text-[#6b7280] mb-1.5">
                  粘贴 arXiv 摘要页 / PDF 直链
                </label>
                <input
                  id="pdf-url-input"
                  type="url"
                  value={urlInput}
                  onChange={(e) => setUrlInput(e.target.value)}
                  placeholder="https://arxiv.org/abs/1706.03762"
                  className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2.5 text-[13px]"
                />
              </div>
              <button
                type="button"
                disabled={addSubmitting || !urlInput.trim()}
                onClick={handleImportUrl}
                className="btn-editorial w-full"
              >
                {addSubmitting ? "正在抓取并解析..." : "抓取链接并加入队列"}
              </button>
            </div>
          )}

          {addError && <p className="text-[12px] text-[#816d70]">{addError}</p>}
        </div>
      </dialog>

      {/* Edit Metadata & Folder Modal */}
      <dialog
        ref={editDialogRef}
        aria-labelledby="edit-meta-title"
        // @ts-expect-error closedby progressive enhancement
        closedby="any"
        className="w-[min(92vw,600px)]"
      >
        <div className="p-6 space-y-5 bg-[#f9f8f6]">
          <div className="flex items-center justify-between border-b border-[#1c1c1c]/15 pb-3">
            <h2 id="edit-meta-title" className="font-serif text-2xl font-normal">
              编辑文献元数据与分组
            </h2>
            <button
              type="button"
              onClick={() => editDialogRef.current?.close()}
              className="p-1.5 border border-[#1c1c1c]/20"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-3 text-[13px]">
            <div>
              <label className="block text-[11px] text-[#6b7280] mb-1">中文译题</label>
              <input
                value={editTitleZh}
                onChange={(e) => setEditTitleZh(e.target.value)}
                className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#6b7280] mb-1">英文原标题</label>
              <input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2"
              />
            </div>
            <div>
              <label className="block text-[11px] text-[#6b7280] mb-1">作者列表（英文逗号分隔）</label>
              <input
                value={editAuthors}
                onChange={(e) => setEditAuthors(e.target.value)}
                className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-[#6b7280] mb-1">期刊 / 会议</label>
                <input
                  value={editVenue}
                  onChange={(e) => setEditVenue(e.target.value)}
                  className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#6b7280] mb-1">发表年份</label>
                <input
                  type="number"
                  value={editYear}
                  onChange={(e) => setEditYear(e.target.value)}
                  className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2"
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] text-[#6b7280] mb-1">分区标签（逗号分隔）</label>
                <input
                  value={editTiers}
                  onChange={(e) => setEditTiers(e.target.value)}
                  placeholder="中科院1区, JCR Q1, CCF-A"
                  className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2"
                />
              </div>
              <div>
                <label className="block text-[11px] text-[#6b7280] mb-1">所属文件夹</label>
                <select
                  value={editFolderId}
                  onChange={(e) => setEditFolderId(e.target.value)}
                  className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 px-3 py-2"
                >
                  <option value="">未分类</option>
                  {foldersData.folders.map((f) => (
                    <option key={f.id} value={f.id}>
                      {f.name}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={() => editDialogRef.current?.close()}
              className="btn-editorial-outline"
            >
              取消
            </button>
            <button type="button" onClick={handleSaveMetadata} className="btn-editorial">
              保存修改
            </button>
          </div>
        </div>
      </dialog>

      {/* Multi-Paper Literature Synthesis Modal */}
      <dialog
        ref={synthDialogRef}
        aria-labelledby="synth-title"
        // @ts-expect-error closedby progressive enhancement
        closedby="any"
        className="w-[min(94vw,760px)]"
      >
        <div className="p-6 space-y-5 bg-[#f9f8f6] max-h-[86dvh] overflow-y-auto">
          <div className="flex items-center justify-between border-b border-[#1c1c1c]/15 pb-3">
            <h2 id="synth-title" className="font-serif text-2xl font-normal">
              多篇文献联合生成综述报告
            </h2>
            <button
              type="button"
              onClick={() => synthDialogRef.current?.close()}
              className="p-1.5 border border-[#1c1c1c]/20"
            >
              <X className="w-4 h-4" />
            </button>
          </div>

          <div className="space-y-2 max-h-56 overflow-y-auto border border-[#1c1c1c]/15 p-3">
            {papers.map((p) => {
              const checked = synthSelectedIds.includes(p.id);
              return (
                <label
                  key={p.id}
                  className="flex items-start gap-2.5 py-1.5 border-b border-[#1c1c1c]/5 last:border-none cursor-pointer text-[13px]"
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={(e) => {
                      setSynthSelectedIds((prev) =>
                        e.target.checked ? [...prev, p.id] : prev.filter((x) => x !== p.id)
                      );
                    }}
                    className="mt-1"
                  />
                  <span>
                    <span className="font-medium">{p.title_zh || p.title}</span>
                    {p.venue ? (
                      <span className="text-[11px] text-[#6b7280] ml-2">({p.venue})</span>
                    ) : null}
                  </span>
                </label>
              );
            })}
          </div>

          <div>
            <label className="block text-[12px] text-[#6b7280] mb-1.5">
              综述聚焦问题（可选，留空按标准学术 Survey 结构生成）
            </label>
            <textarea
              rows={2}
              value={synthQuestion}
              onChange={(e) => setSynthQuestion(e.target.value)}
              placeholder="例如：对比以上各篇的方法复杂度、数据集表现及各自局限性..."
              className="w-full bg-[#f9f8f6] border border-[#1c1c1c]/25 p-3 text-[13px]"
            />
          </div>

          {synthError && <p className="text-[12px] text-[#816d70]">{synthError}</p>}

          <div className="flex justify-end gap-3">
            <button
              type="button"
              disabled={synthLoading}
              onClick={handleRunSynthesis}
              className="btn-editorial"
            >
              {synthLoading ? "AI 正在综合多篇全文生成综述..." : "生成联合综述报告"}
            </button>
          </div>

          {synthResult && (
            <div className="border-t border-[#1c1c1c]/20 pt-5 space-y-3">
              <div className="section-label">Synthesis Output</div>
              <div className="whitespace-pre-wrap text-[14px] leading-[1.75] bg-[#f3f1ed] p-5 border border-[#1c1c1c]/10">
                {synthResult}
              </div>
            </div>
          )}
        </div>
      </dialog>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
