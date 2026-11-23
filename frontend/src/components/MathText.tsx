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

// Supports $$...$$, \[...\], $...$, and \(...\)
const LATEX_TOKEN_REGEX =
  /(\$\$[\s\S]+?\$\$|\\\[[\s\S]+?\\\]|\$[^$\n]+?\$|\\\([\s\S]+?\\\))/g;

// Detects citations wrapped by OCR inside math delimiters like $[5, 9, 12, 18]$ or $^{[13]}$
const MATH_CITATION_REGEX = /^(?:\^\s*\{?\s*)?(\[\s*\d+(?:\s*[,，–—\-]\s*\d+)*\s*\])(?:\s*\}?)?$/;
// Plain non-math tokens mistakenly wrapped in $...$ by OCR (e.g., $2D$, $3D$, $(2D)$, $2\text{D}$, $360^\circ$)
function trySimplifyPlainMathToken(tex: string): string | null {
  const cleaned = tex
    .replace(/\\(?:text|mathrm|mathbf)\{([^}]+)\}/g, "$1")
    .replace(/\^\s*\{?\s*\\circ\s*\}?/g, "°")
    .replace(/\\,/g, "")
    .trim();
  if (
    /^\(?\d+(?:\.\d+)?\s*(?:°|%|D|G|K|M|GB|MB|Hz|kHz|MHz|GHz|mm|cm|m|km|kg|ms|s)?\)?$/.test(
      cleaned
    )
  ) {
    return cleaned;
  }
  return null;
}

function CitationSup({
  rawLabel,
  onClickCitation,
}: {
  rawLabel: string;
  onClickCitation?: (indexStr: string, e: React.MouseEvent<HTMLElement>) => void;
}) {
  const normalized = rawLabel
    .replace(/\s*,\s*/g, ",")
    .replace(/\s*([–—\-])\s*/g, "–")
    .replace(/\[\s+/g, "[")
    .replace(/\s+\]/g, "]");
  const firstNum = normalized.match(/\d+/)?.[0] || "1";

  if (!onClickCitation) {
    return (
      <sup className="inline indent-0 ml-[1px] text-[0.74em] leading-none align-super text-[#816d70] font-sans font-medium">
        {normalized}
      </sup>
    );
  }

  return (
    <sup className="inline indent-0 ml-[1px] text-[0.74em] leading-none align-super font-sans">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onClickCitation(firstNum, e);
        }}
        className="inline indent-0 text-[#816d70] hover:underline font-medium cursor-pointer"
      >
        {normalized}
      </button>
    </sup>
  );
}

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
  const parts = segment.split(LATEX_TOKEN_REGEX);

  return (
    <>
      {parts.map((part, idx) => {
        if (!part) return null;
        if (
          (part.startsWith("$$") && part.endsWith("$$") && part.length > 4) ||
          (part.startsWith("\\[") && part.endsWith("\\]") && part.length > 4)
        ) {
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
          const citMatch = !disableInteractiveTokens ? tex.match(MATH_CITATION_REGEX) : null;
          if (citMatch) {
            return (
              <CitationSup
                key={idx}
                rawLabel={citMatch[1]}
                onClickCitation={onClickCitation}
              />
            );
          }
          const plain = trySimplifyPlainMathToken(tex);
          if (plain !== null) {
            return <React.Fragment key={idx}>{plain}</React.Fragment>;
          }
          return (
            <span
              key={idx}
              className="indent-0"
              dangerouslySetInnerHTML={{ __html: renderKatexHtml(tex, false) }}
            />
          );
        }
        if (part.startsWith("\\(") && part.endsWith("\\)") && part.length > 4) {
          const tex = part.slice(2, -2).trim();
          const citMatch = !disableInteractiveTokens ? tex.match(MATH_CITATION_REGEX) : null;
          if (citMatch) {
            return (
              <CitationSup
                key={idx}
                rawLabel={citMatch[1]}
                onClickCitation={onClickCitation}
              />
            );
          }
          const plain = trySimplifyPlainMathToken(tex);
          if (plain !== null) {
            return <React.Fragment key={idx}>{plain}</React.Fragment>;
          }
          return (
            <span
              key={idx}
              className="indent-0"
              dangerouslySetInnerHTML={{ __html: renderKatexHtml(tex, false) }}
            />
          );
        }

        if (disableInteractiveTokens) {
          return <React.Fragment key={idx}>{part}</React.Fragment>;
        }

        const refRegex =
          /((?:Fig\.?|Figure|Table|Tab\.?)\s*\d+|\[\s*\d+(?:\s*[,，–—\-]\s*\d+)*\s*\])/gi;
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
              if (/^\[\s*\d+(?:\s*[,，–—\-]\s*\d+)*\s*\]$/.test(sub)) {
                return (
                  <CitationSup
                    key={sIdx}
                    rawLabel={sub}
                    onClickCitation={onClickCitation}
                  />
                );
              }
              // Trim stray space directly before a citation bracket so superscript sits snugly against CJK/text
              const nextSub = subParts[sIdx + 1] || "";
              const trimmedSub = /^\[\s*\d+(?:\s*[,，–—\-]\s*\d+)*\s*\]$/.test(nextSub)
                ? sub.replace(/[ \t]+$/, "")
                : sub;
              return <React.Fragment key={sIdx}>{trimmedSub}</React.Fragment>;
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}

function InlineMarkdownMath({ text }: { text: string }) {
  const parts = text.split(LATEX_TOKEN_REGEX);

  return (
    <>
      {parts.map((part, idx) => {
        if (!part) return null;
        if (
          (part.startsWith("$$") && part.endsWith("$$") && part.length > 4) ||
          (part.startsWith("\\[") && part.endsWith("\\]") && part.length > 4)
        ) {
          const tex = part.slice(2, -2).trim();
          return (
            <span
              key={idx}
              className="block my-2.5 overflow-x-auto text-center"
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
        if (part.startsWith("\\(") && part.endsWith("\\)") && part.length > 4) {
          const tex = part.slice(2, -2).trim();
          return (
            <span
              key={idx}
              dangerouslySetInnerHTML={{ __html: renderKatexHtml(tex, false) }}
            />
          );
        }

        const unescaped = part.replace(/\\([*_#\[\]()~`>+\-!])/g, "$1");
        const mdTokens = unescaped.split(/(\*\*[^*\n]+?\*\*|`[^`\n]+?`|\*[^*\n]+?\*)/g);
        return (
          <React.Fragment key={idx}>
            {mdTokens.map((tok, tIdx) => {
              if (!tok) return null;
              if (tok.startsWith("**") && tok.endsWith("**") && tok.length > 4) {
                return (
                  <strong key={tIdx} className="font-semibold text-[#1c1c1c]">
                    {tok.slice(2, -2)}
                  </strong>
                );
              }
              if (tok.startsWith("`") && tok.endsWith("`") && tok.length > 2) {
                return (
                  <code
                    key={tIdx}
                    className="px-1.5 py-0.5 text-[0.9em] bg-[#1c1c1c]/[0.06] font-mono text-[#1c1c1c]"
                  >
                    {tok.slice(1, -1)}
                  </code>
                );
              }
              if (tok.startsWith("*") && tok.endsWith("*") && tok.length > 2) {
                return (
                  <em key={tIdx} className="italic">
                    {tok.slice(1, -1)}
                  </em>
                );
              }
              return <React.Fragment key={tIdx}>{tok}</React.Fragment>;
            })}
          </React.Fragment>
        );
      })}
    </>
  );
}

export function MarkdownMath({ content }: { content: string }) {
  if (!content) return null;

  const normalized = content
    .replace(/\r\n/g, "\n")
    .replace(/\\\[\s*\n?([\s\S]*?)\n?\s*\\\]/g, (_m, tex) => `\n\n$$${tex.trim()}$$\n\n`)
    .replace(/\$\$\s*\n?([\s\S]*?)\n?\s*\$\$/g, (_m, tex) => `\n\n$$${tex.trim()}$$\n\n`);

  const lines = normalized.split("\n");
  const elements: React.ReactNode[] = [];
  let i = 0;

  while (i < lines.length) {
    const line = lines[i].trim();

    if (!line) {
      i += 1;
      continue;
    }

    if (line.startsWith("```")) {
      const codeLines: string[] = [];
      i += 1;
      while (i < lines.length && !lines[i].trim().startsWith("```")) {
        codeLines.push(lines[i]);
        i += 1;
      }
      i += 1;
      elements.push(
        <pre
          key={`code-${i}`}
          className="my-2.5 p-3 bg-[#f2f0ec] border border-[#1c1c1c]/15 overflow-x-auto text-[12px] font-mono leading-relaxed"
        >
          <code>{codeLines.join("\n")}</code>
        </pre>
      );
      continue;
    }

    if (line.startsWith("$$") && line.endsWith("$$") && line.length > 4) {
      const tex = line.slice(2, -2).trim();
      elements.push(
        <div
          key={`eq-${i}`}
          className="my-3 py-2 px-3 bg-[#f2f0ec]/70 border-l-2 border-[#1c1c1c]/25 overflow-x-auto text-center"
          dangerouslySetInnerHTML={{ __html: renderKatexHtml(tex, true) }}
        />
      );
      i += 1;
      continue;
    }

    if (/^(?:-{3,}|\*{3,}|_{3,})$/.test(line)) {
      elements.push(<hr key={`hr-${i}`} className="my-3 border-t border-[#1c1c1c]/15" />);
      i += 1;
      continue;
    }

    const hMatch = line.match(/^(#{1,4})\s+(.+)$/);
    if (hMatch) {
      const lvl = hMatch[1].length;
      const titleText = hMatch[2].trim();
      const cls =
        lvl === 1
          ? "font-serif text-[17px] font-semibold mt-4 mb-1.5 text-[#1c1c1c]"
          : lvl === 2
          ? "font-serif text-[15px] font-semibold mt-3.5 mb-1 text-[#1c1c1c]"
          : "font-serif text-[14px] font-semibold mt-3 mb-1 text-[#1c1c1c]";
      elements.push(
        <div key={`h-${i}`} className={cls}>
          <InlineMarkdownMath text={titleText} />
        </div>
      );
      i += 1;
      continue;
    }

    if (line.startsWith(">")) {
      const quoteLines: string[] = [];
      while (i < lines.length && lines[i].trim().startsWith(">")) {
        quoteLines.push(lines[i].trim().replace(/^>\s?/, ""));
        i += 1;
      }
      elements.push(
        <blockquote
          key={`q-${i}`}
          className="my-2.5 pl-3 border-l-2 border-[#816d70] text-[#1c1c1c]/85 italic space-y-1"
        >
          {quoteLines.map((ql, qIdx) => (
            <p key={qIdx}>
              <InlineMarkdownMath text={ql} />
            </p>
          ))}
        </blockquote>
      );
      continue;
    }

    if (line.includes("|") && i + 1 < lines.length && /^\|?[\s:\-|]+\|?$/.test(lines[i + 1].trim())) {
      const parseCells = (rowStr: string) =>
        rowStr
          .trim()
          .replace(/^\|/, "")
          .replace(/\|$/, "")
          .split("|")
          .map((c) => c.trim());
      const headers = parseCells(line);
      i += 2;
      const rows: string[][] = [];
      while (i < lines.length && lines[i].trim().includes("|")) {
        rows.push(parseCells(lines[i]));
        i += 1;
      }
      elements.push(
        <div key={`tbl-${i}`} className="my-3 overflow-x-auto">
          <table className="w-full border-collapse border border-[#1c1c1c]/20 text-[12px]">
            <thead>
              <tr className="bg-[#f2f0ec]">
                {headers.map((h, hIdx) => (
                  <th
                    key={hIdx}
                    className="border border-[#1c1c1c]/15 px-2.5 py-1.5 text-left font-medium"
                  >
                    <InlineMarkdownMath text={h} />
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r, rIdx) => (
                <tr key={rIdx}>
                  {r.map((cell, cIdx) => (
                    <td key={cIdx} className="border border-[#1c1c1c]/15 px-2.5 py-1.5 align-top">
                      <InlineMarkdownMath text={cell} />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
      continue;
    }

    if (/^[-*•]\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^[-*•]\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^[-*•]\s+/, ""));
        i += 1;
      }
      elements.push(
        <ul key={`ul-${i}`} className="my-2 pl-4 space-y-1.5 list-disc marker:text-[#816d70]">
          {items.map((it, idx) => (
            <li key={idx}>
              <InlineMarkdownMath text={it} />
            </li>
          ))}
        </ul>
      );
      continue;
    }

    if (/^\d+\.\s+/.test(line)) {
      const items: string[] = [];
      while (i < lines.length && /^\d+\.\s+/.test(lines[i].trim())) {
        items.push(lines[i].trim().replace(/^\d+\.\s+/, ""));
        i += 1;
      }
      elements.push(
        <ol key={`ol-${i}`} className="my-2 pl-5 space-y-1.5 list-decimal marker:text-[#6b7280]">
          {items.map((it, idx) => (
            <li key={idx}>
              <InlineMarkdownMath text={it} />
            </li>
          ))}
        </ol>
      );
      continue;
    }

    const paraLines: string[] = [line];
    i += 1;
    while (
      i < lines.length &&
      lines[i].trim() !== "" &&
      !/^(#{1,4}\s+|[-*•]\s+|\d+\.\s+|```|>|---|\*\*\*|\$\$)/.test(lines[i].trim())
    ) {
      paraLines.push(lines[i].trim());
      i += 1;
    }
    elements.push(
      <p key={`p-${i}`} className="my-2 leading-[1.72]">
        <InlineMarkdownMath text={paraLines.join(" ")} />
      </p>
    );
  }

  return <div className="space-y-1 text-[#1c1c1c]">{elements}</div>;
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
                  data-ignore-offset="true"
                  onClick={(e) => {
                    e.stopPropagation();
                    onClickAnchor?.(matchingAnchor);
                  }}
                  aria-label="打开已保存的划词 AI 问答"
                  className="inline indent-0 ml-1 px-1 py-0.5 text-[10px] leading-none tracking-[0.06em] uppercase bg-[#816d70] text-[#f9f8f6] align-super cursor-pointer hover:bg-[#1c1c1c] transition-colors"
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
