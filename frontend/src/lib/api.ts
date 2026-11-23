"use client";

import { useEffect, useRef } from "react";

export interface FolderItem {
  id: string;
  name: string;
  parent_id: string | null;
  sort_order: number;
  paper_count: number;
  created_at: string;
}

export interface FolderTreeResponse {
  total_count: number;
  uncategorized_count: number;
  folders: FolderItem[];
}

export interface PaperItem {
  id: string;
  folder_id: string | null;
  title: string;
  title_zh: string | null;
  authors: string[];
  year: number | null;
  venue: string | null;
  issn: string | null;
  doi: string | null;
  arxiv_id: string | null;
  abstract_en: string | null;
  abstract_zh: string | null;
  journal_tier: string[];
  status: "queued" | "processing" | "ready" | "failed";
  progress: number;
  progress_message: string;
  failed_step: string | null;
  error_message: string | null;
  page_count: number;
  pdf_url: string;
  thumbnail_url: string | null;
  source_url: string | null;
  created_at: string;
  updated_at: string;
}

export interface PaperBlockItem {
  id: string;
  order_index: number;
  type: "heading" | "paragraph" | "equation" | "figure" | "table" | "quote";
  heading_level: number | null;
  section_id: string | null;
  page_num: number;
  en: string;
  zh: string;
  figure_url: string | null;
  figure_label: string | null;
  caption_en: string | null;
  caption_zh: string | null;
  bbox: number[] | null;
}

export interface OutlineItem {
  id: string;
  title_en: string;
  title_zh: string;
  level: number;
  page_num: number;
}

export interface ReferenceItem {
  index: string;
  label: string;
  title: string;
  authors: string;
  year: string;
  venue: string;
  raw: string;
}

export type HighlightColor =
  | "yellow"
  | "green"
  | "blue"
  | "pink"
  | "orange"
  | "purple"
  | "mauve"
  | "amber"
  | "sage"
  | "slate";

export const HIGHLIGHT_PALETTE: { id: HighlightColor; label: string; swatch: string }[] = [
  { id: "yellow", label: "亮黄", swatch: "#fde047" },
  { id: "green", label: "翠绿", swatch: "#86efac" },
  { id: "blue", label: "天蓝", swatch: "#93c5fd" },
  { id: "pink", label: "玫粉", swatch: "#f9a8d4" },
  { id: "orange", label: "明橙", swatch: "#fdba74" },
  { id: "purple", label: "亮紫", swatch: "#d8b4fe" },
];

export interface HighlightItem {
  id: string;
  paper_id: string;
  block_id: string;
  lang: "en" | "zh";
  start_offset: number;
  end_offset: number;
  selected_text: string;
  color: HighlightColor;
  note: string | null;
  created_at: string;
}

export interface ChatMessageItem {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  thinking_content: string | null;
  thinking_level: string | null;
  created_at: string;
}

export interface QAAnchorItem {
  id: string;
  paper_id: string;
  block_id: string;
  thread_id: string;
  lang: "en" | "zh";
  start_offset: number;
  end_offset: number;
  selected_text: string;
  created_at: string;
  messages: ChatMessageItem[];
}

export interface PaperReaderData {
  paper: PaperItem;
  outline: OutlineItem[];
  references_list: ReferenceItem[];
  blocks: PaperBlockItem[];
  highlights: HighlightItem[];
  qa_anchors: QAAnchorItem[];
  paper_thread_id: string;
  paper_messages: ChatMessageItem[];
}

export interface SystemSettingItem {
  global_base_url: string;
  global_api_key_masked: string;
  has_global_api_key: boolean;
  ocr_model: string;
  ocr_base_url: string;
  ocr_api_key_masked: string;
  has_ocr_api_key: boolean;
  translate_model: string;
  translate_base_url: string;
  translate_api_key_masked: string;
  has_translate_api_key: boolean;
  chat_model: string;
  chat_base_url: string;
  chat_api_key_masked: string;
  has_chat_api_key: boolean;
  chat_thinking_level: "low" | "medium" | "high";
}

const TOKEN_KEY = "scholaread_access_token";

export function getStoredToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setStoredToken(token: string | null): void {
  if (typeof window === "undefined") return;
  if (token) {
    window.localStorage.setItem(TOKEN_KEY, token);
  } else {
    window.localStorage.removeItem(TOKEN_KEY);
  }
}

export function withAuthTokenUrl(url: string | null | undefined): string {
  if (!url) return "";
  const token = getStoredToken();
  if (!token) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(token)}`;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit = {}
): Promise<T> {
  const token = getStoredToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${token}`);
  }
  if (
    options.body &&
    !(options.body instanceof FormData) &&
    !headers.has("Content-Type")
  ) {
    headers.set("Content-Type", "application/json");
  }

  const res = await fetch(path, {
    ...options,
    headers,
    credentials: "include",
  });

  if (!res.ok) {
    let msg = `请求失败 (${res.status})`;
    try {
      const data = await res.json();
      if (data?.detail) msg = String(data.detail);
    } catch {
      // ignore
    }
    if (res.status === 401) {
      setStoredToken(null);
    }
    throw new Error(msg);
  }

  if (res.status === 204) return {} as T;
  return (await res.json()) as T;
}

/**
 * Native <dialog> helper with Safari closedby="any" light-dismiss polyfill
 * (modern-web-guidance: dialog)
 */
export function useEditorialDialog(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDialogElement | null>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    if (open && !dialog.open) {
      dialog.showModal();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;

    const handleClose = () => {
      dialog.returnValue = "";
      onClose();
    };
    dialog.addEventListener("close", handleClose);

    // Safari fallback for closedby="any"
    let cleanupOutside: (() => void) | undefined;
    if (!("closedBy" in HTMLDialogElement.prototype)) {
      const outside = (e: PointerEvent) => {
        const r = dialog.getBoundingClientRect();
        return (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        );
      };
      let pressedOutside = false;
      const onDown = (e: PointerEvent) => {
        pressedOutside = outside(e);
      };
      const onUp = (e: PointerEvent) => {
        if (pressedOutside && outside(e) && dialog.open) {
          dialog.close();
        }
      };
      dialog.addEventListener("pointerdown", onDown);
      dialog.addEventListener("pointerup", onUp);
      cleanupOutside = () => {
        dialog.removeEventListener("pointerdown", onDown);
        dialog.removeEventListener("pointerup", onUp);
      };
    }

    return () => {
      dialog.removeEventListener("close", handleClose);
      cleanupOutside?.();
    };
  }, [onClose]);

  return ref;
}
