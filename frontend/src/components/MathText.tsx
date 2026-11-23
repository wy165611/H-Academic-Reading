"use client";

import React from "react";
import katex from "katex";
import { HighlightItem, QAAnchorItem } from "@/lib/api";

interface MathTextProps {
  text: string;
  blockId?: string;
  lang?: "en" | "zh";
  highlights?: HighlightItem[];
  anchors?: QAAnchorItem[];
  activeAnchorId?: string | null;
  onClickAnchor?: (anchor: QAAnchorItem) => void;
  onClickCitation?: (indexStr: string, e: React.MouseEvent<HTMLElement>) => void;
  onClickFigureRef?: (label: string, e: React.MouseEvent<HTMLElement>) => void;
  disableInteractiveTokens?: boolean;
}

function renderKatexHtml(latex: string, displayMode: boolean): string {
  try {
    return katex.renderToString(latex, {
      displayMode,
      throwOnError: false,
      strict: false,
    });
  } catch {
    return latex;
  }
}

/**
 * Render math ($...$, $$...$$), figure/table mentions (Fig. 1, Table 2),
 * and citation brackets ([13], [3,5]) cleanly without shifting original text offsets.
 */
function RichInlineTokens({
  segment,
  onClickCitation,
  onClickFigureRef,
  disableInteractiveTokens,
}: {
  segment: string;
  onClickCitation?: (indexStr: string, e: React.MouseEvent<HTMLElement>) => void;
  onClickFigureRef?: (label: string, e: React.MouseEvent<HTMLElement>) => void;
  disableInteractiveTokens?: boolean;
}) {
  // Split by $$...$$ or $...$
  const mathRegex = /(\$\$[\s\S]+?\$\$|\$[^$\n]+?\$)/g;
  const parts = segment.split(mathRegex);

  return (
    <>
      {parts.map((part, idx) => {
        if (!part) return null;
        if (part.startsWith("$$") && part.endsWith("$$") && part.length > 4) {
          const tex = part.slice(2, -2).trim();
          return (
            <span
              key={idx}
              className="block my-3 overflow-x-auto text-center"
              dangerouslySetInnerHTML={{ __html: renderKatexHtml(tex, true) }}
            />
          );
        }
        if (part.startsWith("$") && part.endsWith("$") && part.length > 2) {
          const tex = part.slice(1, -1).trim();
          return (
            <span
              key={idx}
              dangerouslySetInnerHTML={{ __html: renderKatexHtml(tex, false) }}
            />
          );
        }

        if (disableInteractiveTokens) {
          return <React.Fragment key={idx}>{part}</React.Fragment>;
        }

        // Tokenize figure/table references and citation numbers [13] or [3, 5]
        const refRegex =
          /((?:Fig\.?|Figure|Table|Tab\.?)\s*\d+|\[\s*\d+(?:\s*[,–\-]\s*\d+)*\s*\])/gi;
        const subParts = part.split(refRegex);

        return (
          <React.Fragment key={idx}>
            {subParts.map((sub, sIdx) => {
              if (!sub) return null;
              if (/^(?:Fig\.?|Figure|Table|Tab\.?)\s*\d+$/i.test(sub) && onClickFigureRef) {
                return (
                  <button
                    key={sIdx}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClickFigureRef(sub, e);
                    }}
                    className="inline underline decoration-[#816d70] decoration-1 underline-offset-4 text-[#1c1c1c] hover:text-[#816d70] font-medium mx-0.5 cursor-pointer"
                  >
                    {sub}
                  </button>
                );
              }
              if (/^\[\s*\d+(?:\s*[,–\-]\s*\d+)*\s*\]$/.test(sub) && onClickCitation) {
                const firstNum = sub.match(/\d+/)?.[0] || "1";
                return (
                  <button
                    key={sIdx}
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      onClickCitation(firstNum, e);
                    }}
                    className="inline text-[0.82em] align-super text-[#816d70] hover:underline font-medium mx-0.5 cursor-pointer"
                  >
                    {sub}
                  </button>
                );
              }
              return <React.Fragment key={sIdx}>{sub}</React.Fragment>;
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}

export default function MathText({
  text,
  highlights = [],
  anchors = [],
  activeAnchorId,
  onClickAnchor,
  onClickCitation,
  onClickFigureRef,
  disableInteractiveTokens = false,
}: MathTextProps) {
  if (!text) return null;

  if (highlights.length === 0 && anchors.length === 0) {
    return (
      <RichInlineTokens
        segment={text}
        onClickCitation={onClickCitation}
        onClickFigureRef={onClickFigureRef}
        disableInteractiveTokens={disableInteractiveTokens}
      />
    );
  }

  // Collect all valid boundaries within [0, text.length]
  const points = new Set<number>([0, text.length]);
  for (const h of highlights) {
    const s = Math.max(0, Math.min(text.length, h.start_offset));
    const e = Math.max(0, Math.min(text.length, h.end_offset));
    if (s < e) {
      points.add(s);
      points.add(e);
    }
  }
  for (const a of anchors) {
    const s = Math.max(0, Math.min(text.length, a.start_offset));
    const e = Math.max(0, Math.min(text.length, a.end_offset));
    if (s < e) {
      points.add(s);
      points.add(e);
    }
  }

  const sorted = Array.from(points).sort((a, b) => a - b);

  return (
    <>
      {sorted.slice(0, -1).map((start, idx) => {
        const end = sorted[idx + 1];
        const slice = text.slice(start, end);
        if (!slice) return null;

        const matchingAnchor = anchors.find(
          (a) => a.start_offset <= start && a.end_offset >= end
        );
        const matchingHighlight = highlights.find(
          (h) => h.start_offset <= start && h.end_offset >= end
        );

        const isAnchorEnd =
          matchingAnchor &&
          Math.min(text.length, matchingAnchor.end_offset) === end;

        const hlClass = matchingHighlight ? `hl-${matchingHighlight.color}` : "";

        if (matchingAnchor) {
          const isActive = activeAnchorId === matchingAnchor.id;
          return (
            <span
              key={`${start}-${end}`}
              onClick={(e) => {
                // Avoid triggering if user is actively making a new text selection
                const sel = window.getSelection()?.toString() || "";
                if (sel.trim().length > 0) return;
                e.stopPropagation();
                onClickAnchor?.(matchingAnchor);
              }}
              title="点击回看并继续此段 AI 对话"
              className={`qa-anchor-mark ${isActive ? "qa-anchor-mark-active" : ""} ${hlClass}`}
            >
              <RichInlineTokens
                segment={slice}
                onClickCitation={onClickCitation}
                onClickFigureRef={onClickFigureRef}
                disableInteractiveTokens={disableInteractiveTokens}
              />
              {isAnchorEnd && (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClickAnchor?.(matchingAnchor);
                  }}
                  aria-label="打开已保存的划词 AI 问答"
                  className="inline-flex items-center gap-0.5 ml-1 px-1 py-0 text-[10px] tracking-[0.06em] uppercase bg-[#816d70] text-[#f9f8f6] align-baseline cursor-pointer hover:bg-[#1c1c1c] transition-colors"
                >
                  AI ✦ {Math.max(1, Math.floor((matchingAnchor.messages?.length || 2) / 2))}
                </button>
              )}
            </span>
          );
        }

        if (matchingHighlight) {
          return (
            <mark key={`${start}-${end}`} className={`${hlClass} text-inherit`}>
              <RichInlineTokens
                segment={slice}
                onClickCitation={onClickCitation}
                onClickFigureRef={onClickFigureRef}
                disableInteractiveTokens={disableInteractiveTokens}
              />
            </mark>
          );
        }

        return (
          <RichInlineTokens
            key={`${start}-${end}`}
            segment={slice}
            onClickCitation={onClickCitation}
            onClickFigureRef={onClickFigureRef}
            disableInteractiveTokens={disableInteractiveTokens}
          />
        );
      })}
    </>
  );
}
