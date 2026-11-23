import asyncio
import base64
import gc
import io
import json
import logging
import re
import uuid
from pathlib import Path
from typing import Any, Optional

import fitz  # PyMuPDF
from PIL import Image

from app.config import settings
from app.database import SessionLocal
from app.models import Paper, PaperBlock
from app.services.llm_service import (
    LLMServiceError,
    ResolvedModuleConfig,
    call_chat_completion,
    clean_and_parse_json,
    resolve_module_config,
)
from app.services.metadata_service import extract_rich_metadata

logger = logging.getLogger(__name__)

# Strictly single-concurrency queue for 2C4G servers
_pdf_queue: Optional[asyncio.Queue[str]] = None
_worker_task: Optional[asyncio.Task] = None


def _update_paper_progress(
    paper_id: str,
    *,
    status: Optional[str] = None,
    progress: Optional[int] = None,
    progress_message: Optional[str] = None,
    failed_step: Optional[str] = None,
    error_message: Optional[str] = None,
    clear_error: bool = False,
) -> None:
    db = SessionLocal()
    try:
        paper = db.query(Paper).filter(Paper.id == paper_id).first()
        if not paper:
            return
        if status is not None:
            paper.status = status
        if progress is not None:
            paper.progress = max(0, min(100, progress))
        if progress_message is not None:
            paper.progress_message = progress_message[:250]
        if failed_step is not None:
            paper.failed_step = failed_step
        if error_message is not None:
            paper.error_message = error_message
        if clear_error:
            paper.failed_step = None
            paper.error_message = None
        db.commit()
    finally:
        db.close()


def _crop_qwen_bbox_to_png(
    page_img: Image.Image,
    bbox: list[Any],
    paper_id: str,
    page_num: int,
    fig_idx: int,
) -> Optional[str]:
    """
    Convert Qwen 0-1000 normalized [x1, y1, x2, y2] bbox to pixel box with +1% margin padding,
    crop cleanly using Pillow, save to ./data/figures and return /api/files/figures/<name>.
    """
    if not isinstance(bbox, (list, tuple)) or len(bbox) != 4:
        return None
    try:
        x1_n, y1_n, x2_n, y2_n = [float(v) for v in bbox]
    except (TypeError, ValueError):
        return None

    # Normalize if someone returned 0..1 floats instead of 0..1000
    if max(x1_n, y1_n, x2_n, y2_n) <= 1.0:
        x1_n, y1_n, x2_n, y2_n = x1_n * 1000, y1_n * 1000, x2_n * 1000, y2_n * 1000

    x1_n, x2_n = min(x1_n, x2_n), max(x1_n, x2_n)
    y1_n, y2_n = min(y1_n, y2_n), max(y1_n, y2_n)

    w, h = page_img.size
    if w <= 0 or h <= 0:
        return None

    # Expand 1% outward margin on all four sides to avoid tight clipping
    pad_x = int(round(w * 0.01))
    pad_y = int(round(h * 0.01))

    left = max(0, int(round((x1_n / 1000.0) * w)) - pad_x)
    top = max(0, int(round((y1_n / 1000.0) * h)) - pad_y)
    right = min(w, int(round((x2_n / 1000.0) * w)) + pad_x)
    bottom = min(h, int(round((y2_n / 1000.0) * h)) + pad_y)

    if right - left < 24 or bottom - top < 24:
        return None

    filename = f"{paper_id}_p{page_num}_{fig_idx}_{uuid.uuid4().hex[:6]}.png"
    out_path = settings.figures_dir / filename
    cropped = page_img.crop((left, top, right, bottom))
    try:
        cropped.save(out_path, format="PNG", optimize=True)
    finally:
        cropped.close()

    return f"/api/files/figures/{filename}"


def _fallback_extract_page_blocks(
    page: fitz.Page,
    page_img: Image.Image,
    paper_id: str,
    page_num: int,
) -> list[dict[str, Any]]:
    """
    Deterministic local fallback extractor when no API Key is configured yet.
    Handles column-aware text sorting, basic heading detection, and image/figure bbox cropping
    through the same 0-1000 -> +1% margin crop pipeline.
    """
    rect = page.rect
    pw, ph = max(1.0, rect.width), max(1.0, rect.height)
    raw_blocks = page.get_text("blocks") or []

    text_items: list[tuple[float, float, float, float, str]] = []
    img_boxes: list[tuple[float, float, float, float]] = []

    for blk in raw_blocks:
        x0, y0, x1, y1, content, _blk_no, blk_type = blk[:7]
        # Skip likely running headers/footers (top 5% or bottom 5%)
        if y1 < ph * 0.055 or y0 > ph * 0.945:
            continue
        if blk_type == 1:
            img_boxes.append((x0, y0, x1, y1))
            continue
        txt = re.sub(r"\s+\n", "\n", str(content or "")).strip()
        if not txt:
            continue
        # Join soft line breaks inside a PDF block
        txt = re.sub(r"-\s*\n\s*", "", txt)
        txt = re.sub(r"\s*\n\s*", " ", txt).strip()
        if txt:
            text_items.append((x0, y0, x1, y1, txt))

    # Detect two-column vs single-column layout by block centers
    mid_x = pw * 0.5
    narrow_blocks = [b for b in text_items if (b[2] - b[0]) < pw * 0.48]
    left_col = [b for b in narrow_blocks if (b[0] + b[2]) * 0.5 < mid_x]
    right_col = [b for b in narrow_blocks if (b[0] + b[2]) * 0.5 >= mid_x]

    if len(left_col) >= 2 and len(right_col) >= 2:
        wide_top = sorted(
            [b for b in text_items if (b[2] - b[0]) >= pw * 0.48 and b[1] < ph * 0.4],
            key=lambda b: b[1],
        )
        wide_bottom = sorted(
            [b for b in text_items if (b[2] - b[0]) >= pw * 0.48 and b[1] >= ph * 0.4],
            key=lambda b: b[1],
        )
        ordered = (
            wide_top
            + sorted(left_col, key=lambda b: b[1])
            + sorted(right_col, key=lambda b: b[1])
            + wide_bottom
        )
    else:
        ordered = sorted(text_items, key=lambda b: (round(b[1], 1), round(b[0], 1)))

    results: list[dict[str, Any]] = []
    in_references = False

    def _is_cjk(ch: str) -> bool:
        return "\u4e00" <= ch <= "\u9fff"

    def _join_text(prev_s: str, next_s: str) -> str:
        prev_s = prev_s.rstrip()
        next_s = next_s.lstrip()
        if not prev_s:
            return next_s
        if not next_s:
            return prev_s
        if prev_s.endswith("-") and len(prev_s) >= 2 and prev_s[-2].isalpha():
            return prev_s[:-1] + next_s
        if _is_cjk(prev_s[-1]) or _is_cjk(next_s[0]):
            return prev_s + next_s
        return prev_s + " " + next_s

    prev_box: Optional[tuple[float, float, float, float]] = None
    terminal_chars = (".", "?", "!", "。", "？", "！", ":", "：", "”", '"', "）", ")")
    meta_prefix_re = re.compile(
        r"^(?:关键词|关键字|作者|出处|许可|说明|原题|摘要|参考文献|keywords|abstract|author)\s*[:：\[【]?",
        re.IGNORECASE,
    )

    for x0, y0, x1, y1, txt in ordered:
        low = txt.lower()
        if (
            re.match(r"^(references|bibliography|参考文献)\b", low)
            and len(txt) < 40
        ):
            in_references = True
            prev_box = None
            results.append(
                {
                    "type": "heading",
                    "heading_level": 1,
                    "en": txt,
                    "page_num": page_num,
                }
            )
            continue

        if in_references:
            prev_box = None
            results.append({"type": "reference", "en": txt, "page_num": page_num})
            continue

        is_numbered_heading = bool(
            re.match(
                r"^(\d+(?:\.\d+)*|[IVX]+)\s+[\u4e00-\u9fffA-Za-z][^\n]{0,65}$",
                txt,
            )
            and len(txt) <= 70
            and not txt.endswith(("。", ".", "，", ","))
        )
        is_common_heading = (
            low
            in (
                "abstract",
                "introduction",
                "related work",
                "methodology",
                "methods",
                "experiments",
                "results",
                "discussion",
                "conclusion",
                "conclusions",
                "acknowledgments",
                "acknowledgements",
                "摘要",
                "引言",
                "结论",
                "讨论",
                "致谢",
                "文献信息",
            )
            or bool(re.match(r"^(?:摘要|引言|结论)\s*[\[\(【].*[\]\)】]$", txt))
        )
        if is_numbered_heading or is_common_heading:
            level = 2 if re.match(r"^\d+\.\d+", txt) else 1
            prev_box = None
            results.append(
                {
                    "type": "heading",
                    "heading_level": level,
                    "en": txt,
                    "page_num": page_num,
                }
            )
        elif re.match(r"^(fig\.?|figure|table|图|表)\s*\d+", low):
            label_m = re.match(r"^((?:fig\.?|figure|table|图|表)\s*\d+)", txt, re.IGNORECASE)
            prev_box = None
            results.append(
                {
                    "type": "figure" if ("fig" in low or txt.startswith("图")) else "table",
                    "figure_label": label_m.group(1) if label_m else None,
                    "caption_en": txt,
                    "en": "",
                    "page_num": page_num,
                }
            )
        else:
            merged_into_prev = False
            if results and results[-1].get("type") == "paragraph" and prev_box is not None:
                px0, py0, px1, py1 = prev_box
                prev_h = max(8.0, py1 - py0)
                v_gap = y0 - py1
                same_col = abs(x0 - px0) < pw * 0.12
                prev_txt = results[-1].get("en") or ""
                is_new_meta = bool(meta_prefix_re.match(txt))
                prev_ended = prev_txt.rstrip().endswith(terminal_chars)
                if (
                    same_col
                    and not is_new_meta
                    and -prev_h * 0.5 <= v_gap <= prev_h * 0.9
                    and not prev_ended
                ):
                    results[-1]["en"] = _join_text(prev_txt, txt)
                    prev_box = (min(px0, x0), py0, max(px1, x1), y1)
                    merged_into_prev = True

            if not merged_into_prev:
                results.append({"type": "paragraph", "en": txt, "page_num": page_num})
                prev_box = (x0, y0, x1, y1)

    # Crop detected image boxes if any
    for idx, (x0, y0, x1, y1) in enumerate(img_boxes, start=1):
        norm_bbox = [
            round((x0 / pw) * 1000, 1),
            round((y0 / ph) * 1000, 1),
            round((x1 / pw) * 1000, 1),
            round((y1 / ph) * 1000, 1),
        ]
        fig_url = _crop_qwen_bbox_to_png(page_img, norm_bbox, paper_id, page_num, idx)
        if fig_url:
            results.append(
                {
                    "type": "figure",
                    "figure_label": f"Figure (Page {page_num})",
                    "figure_url": fig_url,
                    "bbox": norm_bbox,
                    "caption_en": f"Extracted figure from page {page_num}",
                    "en": "",
                    "page_num": page_num,
                }
            )

    return results


async def _vision_parse_single_page(
    png_bytes: bytes,
    page_img: Image.Image,
    paper_id: str,
    page_num: int,
    total_pages: int,
    ocr_cfg: ResolvedModuleConfig,
) -> list[dict[str, Any]]:
    b64_img = base64.b64encode(png_bytes).decode("ascii")
    data_uri = f"data:image/png;base64,{b64_img}"

    prompt = (
        f"你是一个学术论文版面视觉重排与 OCR 专家。当前提供论文第 {page_num}/{total_pages} 页的高清图像。\n"
        "请严格按照人类正常单栏阅读顺序输出这一页的结构化内容 JSON 数组（不要输出任何多余解释或 Markdown 以外文字）：\n"
        "1. 合并双栏/多栏排版为自然单栏阅读顺序；彻底剔除页眉、页脚、页码、水印与侧边行号。\n"
        "2. 所有行内数学公式转为标准 LaTeX `$...$`，独立公式块转为 `$$...$$`。\n"
        "3. 保留正文中的图表引用（如 `Fig. 1`、`Table 2`）与参考文献引用角标（如 `[13]`、`[3,5]`）。\n"
        "4. 每个数组元素格式如下：\n"
        '   - 章节标题: {"type": "heading", "heading_level": 1或2或3, "text": "章节标题英文原文"}\n'
        '   - 正文段落: {"type": "paragraph", "text": "完整英文段落（含$...$行内公式）"}\n'
        '   - 独立公式: {"type": "equation", "text": "$$...$$"}\n'
        '   - 图像或表格: {"type": "figure" 或 "table", "figure_label": "Fig. 1 或 Table 2", "bbox": [x1, y1, x2, y2], "caption_en": "完整英文图注/表注"}\n'
        '   - 参考文献条目: {"type": "reference", "text": "[1] Author, Title, Venue, Year."}\n'
        "5. 【关键坐标规范】：所有 figure/table 的 bbox 必须采用 Qwen 0-1000 归一化坐标 [x1, y1, x2, y2]（左上角 [0, 0]，右下角 [1000, 1000]），框选完整图像或表格主体（尽量贴合图形/表格区域，图注放在 caption_en 中）。\n"
        "请直接返回 JSON 数组 [...] ："
    )

    messages = [
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": data_uri}},
                {"type": "text", "text": prompt},
            ],
        }
    ]

    content, _ = await call_chat_completion(
        ocr_cfg,
        messages,
        temperature=0.1,
        max_tokens=4096,
        timeout_sec=150.0,
    )

    parsed = clean_and_parse_json(content)
    if isinstance(parsed, dict):
        parsed = parsed.get("blocks") or parsed.get("items") or parsed.get("content") or []
    if not isinstance(parsed, list):
        raise ValueError(f"Page {page_num} vision output is not a JSON list")

    page_blocks: list[dict[str, Any]] = []
    fig_counter = 0

    for item in parsed:
        if not isinstance(item, dict):
            continue
        btype = str(item.get("type") or "paragraph").lower().strip()
        if btype not in ("heading", "paragraph", "equation", "figure", "table", "reference", "quote"):
            btype = "paragraph"

        text_val = str(item.get("text") or item.get("en") or "").strip()
        if btype in ("figure", "table"):
            fig_counter += 1
            bbox = item.get("bbox")
            fig_url = _crop_qwen_bbox_to_png(page_img, bbox, paper_id, page_num, fig_counter)
            caption_en = str(item.get("caption_en") or item.get("caption") or text_val or "").strip()
            fig_label = str(item.get("figure_label") or item.get("label") or "").strip() or None
            if not fig_label and caption_en:
                m = re.match(r"^((?:Fig\.?|Figure|Table)\s*\d+)", caption_en, re.IGNORECASE)
                if m:
                    fig_label = m.group(1)
            page_blocks.append(
                {
                    "type": btype,
                    "figure_label": fig_label,
                    "figure_url": fig_url,
                    "bbox": bbox if isinstance(bbox, list) else None,
                    "caption_en": caption_en,
                    "en": "",
                    "page_num": page_num,
                }
            )
        elif text_val:
            blk: dict[str, Any] = {
                "type": btype,
                "en": text_val,
                "page_num": page_num,
            }
            if btype == "heading":
                lvl = item.get("heading_level") or 1
                try:
                    blk["heading_level"] = max(1, min(3, int(lvl)))
                except (TypeError, ValueError):
                    blk["heading_level"] = 1
            page_blocks.append(blk)

    return page_blocks


def _merge_cross_page_paragraphs(raw_blocks: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """
    Step 4a: Merge paragraphs split across page boundaries (and stray broken lines within a page)
    when the preceding paragraph lacks terminal punctuation and the next block is a plain paragraph.
    """
    merged: list[dict[str, Any]] = []
    terminal_chars = (".", "?", "!", "。", "？", "！", ":", "：", "”", '"', ")", "]", "）")
    list_start_re = re.compile(
        r"^(?:\[\d+\]|\d+[\.\)]|\([a-zA-Z0-9]+\)|[•\-\*]|关键词|作者|出处|许可|说明|原题)\s*"
    )

    def _is_cjk(ch: str) -> bool:
        return "\u4e00" <= ch <= "\u9fff"

    for blk in raw_blocks:
        if (
            merged
            and merged[-1].get("type") == "paragraph"
            and blk.get("type") == "paragraph"
        ):
            prev_text = (merged[-1].get("en") or "").rstrip()
            curr_text = (blk.get("en") or "").lstrip()
            if (
                prev_text
                and curr_text
                and not prev_text.endswith(terminal_chars)
                and not list_start_re.match(curr_text)
            ):
                if prev_text.endswith("-") and len(prev_text) >= 2 and prev_text[-2].isalpha():
                    merged[-1]["en"] = prev_text[:-1] + curr_text
                elif _is_cjk(prev_text[-1]) or _is_cjk(curr_text[0]):
                    merged[-1]["en"] = prev_text + curr_text
                else:
                    merged[-1]["en"] = prev_text + " " + curr_text
                continue
        merged.append(blk)
    return merged


def _structure_outline_and_references(
    blocks: list[dict[str, Any]],
) -> tuple[list[dict[str, Any]], list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Step 4b: Extract hierarchical outline tree, assign section_id to each block,
    and parse reference blocks into structured citation entries.
    """
    outline: list[dict[str, Any]] = []
    references_raw: list[str] = []
    content_blocks: list[dict[str, Any]] = []

    current_sec_id: Optional[str] = None
    sec_counter = 0

    for blk in blocks:
        btype = blk.get("type")
        if btype == "reference":
            references_raw.append(blk.get("en") or "")
            continue

        if btype == "heading":
            sec_counter += 1
            sec_id = f"sec_{sec_counter}"
            current_sec_id = sec_id
            blk["section_id"] = sec_id
            outline.append(
                {
                    "id": sec_id,
                    "title_en": blk.get("en") or "",
                    "title_zh": "",
                    "level": blk.get("heading_level") or 1,
                    "page_num": blk.get("page_num") or 1,
                }
            )
            content_blocks.append(blk)
            continue

        blk["section_id"] = current_sec_id
        content_blocks.append(blk)

    # Parse structured references
    joined_refs = "\n".join(references_raw)
    references_list: list[dict[str, Any]] = []
    # Split entries by [n] or leading number
    chunks = re.split(r"(?=(?:^|\n)\s*\[\d+\]\s+)", joined_refs)
    seen_indices: set[str] = set()

    for chunk in chunks:
        line = re.sub(r"\s+", " ", chunk).strip()
        if not line:
            continue
        m = re.match(r"^\[(\d+)\]\s*(.+)$", line)
        if m:
            idx = m.group(1)
            body = m.group(2).strip()
        else:
            idx = str(len(references_list) + 1)
            body = line
        if idx in seen_indices:
            continue
        seen_indices.add(idx)

        year_m = re.search(r"\b(19\d{2}|20\d{2})\b", body)
        year = year_m.group(1) if year_m else ""
        # Heuristic split: authors, "Title" or sentence, venue
        parts = [p.strip() for p in body.split(".") if p.strip()]
        authors = parts[0] if len(parts) >= 1 else ""
        title = parts[1] if len(parts) >= 2 else body
        venue = parts[2] if len(parts) >= 3 else ""

        references_list.append(
            {
                "index": idx,
                "label": f"[{idx}]",
                "title": title[:300],
                "authors": authors[:200],
                "year": year,
                "venue": venue[:160],
                "raw": body[:600],
            }
        )

    return content_blocks, outline, references_list


async def _translate_blocks_concurrently(
    blocks: list[dict[str, Any]],
    outline: list[dict[str, Any]],
    translate_cfg: ResolvedModuleConfig,
    paper_id: str,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Step 5: Batch blocks by character budget with 1-paragraph leading/trailing read-only context
    for terminology consistency, and translate concurrently via asyncio.Semaphore(4).
    Preserves LaTeX ($...$, $$...$$), figure mentions, and citation brackets ([13]).
    """
    translatable_indices: list[int] = []
    for idx, blk in enumerate(blocks):
        btype = blk.get("type")
        if btype in ("heading", "paragraph", "quote") and (blk.get("en") or "").strip():
            translatable_indices.append(idx)
        elif btype in ("figure", "table") and (blk.get("caption_en") or "").strip():
            translatable_indices.append(idx)

    if not translatable_indices:
        return blocks, outline

    if not translate_cfg.api_key:
        # No API key configured: leave zh empty / readable placeholder notice on headings only
        return blocks, outline

    # Group into batches of up to 6 items or ~1800 chars
    batches: list[list[int]] = []
    curr_batch: list[int] = []
    curr_chars = 0

    for idx in translatable_indices:
        blk = blocks[idx]
        txt = blk.get("caption_en") if blk["type"] in ("figure", "table") else blk.get("en", "")
        tlen = len(txt or "")
        if curr_batch and (len(curr_batch) >= 6 or curr_chars + tlen > 1800):
            batches.append(curr_batch)
            curr_batch = []
            curr_chars = 0
        curr_batch.append(idx)
        curr_chars += tlen
    if curr_batch:
        batches.append(curr_batch)

    sem = asyncio.Semaphore(4)
    completed_batches = 0
    total_batches = len(batches)

    async def translate_one_batch(batch_indices: list[int]) -> dict[int, str]:
        nonlocal completed_batches
        async with sem:
            first_i = batch_indices[0]
            last_i = batch_indices[-1]
            prev_ctx = ""
            if first_i > 0:
                pb = blocks[first_i - 1]
                prev_ctx = (pb.get("en") or pb.get("caption_en") or "")[:400]
            next_ctx = ""
            if last_i + 1 < len(blocks):
                nb = blocks[last_i + 1]
                next_ctx = (nb.get("en") or nb.get("caption_en") or "")[:400]

            items_payload = []
            for bi in batch_indices:
                b = blocks[bi]
                src_text = b.get("caption_en") if b["type"] in ("figure", "table") else b.get("en", "")
                items_payload.append({"idx": bi, "type": b["type"], "text": src_text})

            prompt = (
                "你是精通中英文学术论文翻译的资深学者。请将下方【待翻译段落列表】翻译为流畅、严谨、地道的学术中文。\n"
                "严格要求：\n"
                "1. 绝对不得破坏或改动任何 LaTeX 数学公式（`$...$` 与 `$$...$$`）、图表引用（如 `Fig. 1`, `Table 2`）以及引用角标（如 `[13]`, `[3,5]`）。\n"
                "2. 参考前后只读上下文保持专业术语译名全篇一致。\n"
                "3. 返回严格合法的 JSON 对象，格式为 `{\"translations\": {\"<idx>\": \"中文译文\"}}`，不要输出其他说明。\n\n"
                f"【上文只读参考】: {prev_ctx or '无'}\n"
                f"【下文只读参考】: {next_ctx or '无'}\n"
                f"【待翻译段落列表】:\n{json.dumps(items_payload, ensure_ascii=False)}"
            )

            content, _ = await call_chat_completion(
                translate_cfg,
                [
                    {"role": "system", "content": "You output strictly valid JSON only."},
                    {"role": "user", "content": prompt},
                ],
                temperature=0.2,
                max_tokens=4096,
                timeout_sec=120.0,
            )
            parsed = clean_and_parse_json(content)
            trans_map = parsed.get("translations") if isinstance(parsed, dict) else {}
            if not isinstance(trans_map, dict):
                trans_map = parsed if isinstance(parsed, dict) else {}

            result: dict[int, str] = {}
            for bi in batch_indices:
                val = trans_map.get(str(bi)) or trans_map.get(bi)
                if isinstance(val, str) and val.strip():
                    result[bi] = val.strip()

            completed_batches += 1
            pct = 72 + int((completed_batches / max(1, total_batches)) * 25)
            _update_paper_progress(
                paper_id,
                progress=pct,
                progress_message=f"第 5/5 步：学术中文并发精翻 ({completed_batches}/{total_batches} 批)...",
            )
            return result

    batch_results = await asyncio.gather(*(translate_one_batch(b) for b in batches))
    for mapping in batch_results:
        for bi, zh_text in mapping.items():
            blk = blocks[bi]
            if blk["type"] in ("figure", "table"):
                blk["caption_zh"] = zh_text
            else:
                blk["zh"] = zh_text

    # Sync translated headings into outline
    heading_zh_by_sec = {
        blk["section_id"]: blk.get("zh") or ""
        for blk in blocks
        if blk.get("type") == "heading" and blk.get("section_id")
    }
    for sec in outline:
        sec_id = sec.get("id")
        if sec_id and heading_zh_by_sec.get(sec_id):
            sec["title_zh"] = heading_zh_by_sec[sec_id]

    return blocks, outline


async def process_paper_pipeline(paper_id: str) -> None:
    """
    Execute the 5-step Module 2 pipeline inside the single-concurrency worker.
    """
    db = SessionLocal()
    try:
        paper = db.query(Paper).filter(Paper.id == paper_id).first()
        if not paper:
            return
        pdf_path = settings.pdfs_dir / paper.pdf_filename
        fallback_title = paper.title
        ocr_cfg = resolve_module_config(db, "ocr")
        translate_cfg = resolve_module_config(db, "translate")
    finally:
        db.close()

    if not pdf_path.exists():
        _update_paper_progress(
            paper_id,
            status="failed",
            progress=0,
            failed_step="init",
            progress_message="PDF 原文件不存在",
            error_message=f"找不到文件: {pdf_path.name}",
        )
        return

    current_step = "step1_render"
    try:
        _update_paper_progress(
            paper_id,
            status="processing",
            progress=5,
            progress_message="第 1/5 步：正在生成首页封面缩略图...",
            clear_error=True,
        )

        # Step 1: Thumbnail & first 2 pages raw text (low memory)
        doc = fitz.open(str(pdf_path))
        page_count = len(doc)
        first_two_pages_text = ""
        thumb_url: Optional[str] = None

        try:
            if page_count > 0:
                p0 = doc[0]
                thumb_pix = p0.get_pixmap(dpi=130, alpha=False)
                thumb_name = f"{paper_id}.png"
                thumb_pix.save(str(settings.thumbnails_dir / thumb_name))
                thumb_url = f"/api/files/thumbnails/{thumb_name}"
                del thumb_pix
                del p0

            for i in range(min(2, page_count)):
                p = doc[i]
                first_two_pages_text += f"\n--- Page {i + 1} ---\n" + (p.get_text("text") or "")
                del p
        finally:
            doc.close()
            gc.collect()

        # Step 2: Metadata & Journal Tier extraction
        current_step = "step2_metadata"
        _update_paper_progress(
            paper_id,
            progress=14,
            progress_message="第 2/5 步：正在自动识别文献元数据与期刊分区...",
        )
        meta = await extract_rich_metadata(first_two_pages_text, fallback_title, translate_cfg)

        db = SessionLocal()
        try:
            paper = db.query(Paper).filter(Paper.id == paper_id).first()
            if not paper:
                return
            paper.page_count = page_count
            paper.thumbnail_url = thumb_url
            paper.title = meta["title"] or paper.title
            paper.title_zh = meta.get("title_zh")
            paper.authors = meta.get("authors") or []
            paper.venue = meta.get("venue")
            paper.year = meta.get("year")
            paper.issn = meta.get("issn")
            paper.doi = meta.get("doi")
            paper.arxiv_id = meta.get("arxiv_id")
            paper.abstract_en = meta.get("abstract_en")
            paper.abstract_zh = meta.get("abstract_zh")
            paper.journal_tier = meta.get("journal_tier") or []
            db.commit()
        finally:
            db.close()

        # Step 3: Streaming page-by-page Vision OCR + Figure/Table bbox crop (1 page in RAM at a time)
        current_step = "step3_vision_ocr"
        all_raw_blocks: list[dict[str, Any]] = []
        has_vision_key = bool(ocr_cfg.api_key)

        doc = fitz.open(str(pdf_path))
        try:
            for page_idx in range(page_count):
                page_num = page_idx + 1
                pct = 20 + int((page_num / max(1, page_count)) * 45)
                mode_label = f"视觉模型 ({ocr_cfg.model})" if has_vision_key else "本地版面重排"
                _update_paper_progress(
                    paper_id,
                    progress=pct,
                    progress_message=f"第 3/5 步：正在用{mode_label}流式解析第 {page_num}/{page_count} 页...",
                )

                page = doc[page_idx]
                pix = page.get_pixmap(dpi=settings.PDF_RENDER_DPI, alpha=False)
                png_bytes = pix.tobytes("png")
                page_img = Image.open(io.BytesIO(png_bytes)).convert("RGB")

                try:
                    if has_vision_key:
                        try:
                            page_blocks = await _vision_parse_single_page(
                                png_bytes, page_img, paper_id, page_num, page_count, ocr_cfg
                            )
                        except (ValueError, json.JSONDecodeError) as parse_exc:
                            logger.warning(
                                "Page %d vision JSON malformed (%s), falling back locally for this page",
                                page_num,
                                parse_exc,
                            )
                            page_blocks = _fallback_extract_page_blocks(
                                page, page_img, paper_id, page_num
                            )
                    else:
                        page_blocks = _fallback_extract_page_blocks(
                            page, page_img, paper_id, page_num
                        )
                    all_raw_blocks.extend(page_blocks)
                finally:
                    # Strictly close and free per-page image memory immediately
                    page_img.close()
                    del page_img
                    del png_bytes
                    del pix
                    del page
                    gc.collect()
        finally:
            doc.close()
            gc.collect()

        # Step 4: Cross-page paragraph stitching, outline tree & structured references
        current_step = "step4_postprocess"
        _update_paper_progress(
            paper_id,
            progress=68,
            progress_message="第 4/5 步：跨页断段拼接、生成目录树与结构化参考文献...",
        )
        stitched_blocks = _merge_cross_page_paragraphs(all_raw_blocks)
        content_blocks, outline, references_list = _structure_outline_and_references(stitched_blocks)

        # Step 5: Concurrent academic translation with context window & Semaphore(4)
        current_step = "step5_translate"
        _update_paper_progress(
            paper_id,
            progress=72,
            progress_message="第 5/5 步：正在分段并发精翻为学术中文...",
        )
        translated_blocks, outline = await _translate_blocks_concurrently(
            content_blocks, outline, translate_cfg, paper_id
        )

        # Persist all blocks in one clean transaction
        db = SessionLocal()
        try:
            paper = db.query(Paper).filter(Paper.id == paper_id).first()
            if not paper:
                return
            db.query(PaperBlock).filter(PaperBlock.paper_id == paper_id).delete()

            db_blocks: list[PaperBlock] = []
            for order_idx, blk in enumerate(translated_blocks):
                db_blocks.append(
                    PaperBlock(
                        id=f"{paper_id}_b{order_idx}",
                        paper_id=paper_id,
                        order_index=order_idx,
                        type=blk.get("type", "paragraph"),
                        heading_level=blk.get("heading_level"),
                        section_id=blk.get("section_id"),
                        page_num=int(blk.get("page_num", 1)),
                        en=blk.get("en") or "",
                        zh=blk.get("zh") or "",
                        figure_url=blk.get("figure_url"),
                        figure_label=blk.get("figure_label"),
                        caption_en=blk.get("caption_en"),
                        caption_zh=blk.get("caption_zh"),
                        bbox=blk.get("bbox"),
                    )
                )
            db.add_all(db_blocks)
            paper.outline = outline
            paper.references_list = references_list
            paper.status = "ready"
            paper.progress = 100
            paper.progress_message = (
                "已就绪"
                if has_vision_key and translate_cfg.api_key
                else "已就绪（本地基础解析，填入百炼 API Key 后可重新解析）"
            )
            paper.failed_step = None
            paper.error_message = None
            db.commit()
        finally:
            db.close()

    except LLMServiceError as exc:
        logger.exception("Pipeline LLM error at %s for paper %s", current_step, paper_id)
        _update_paper_progress(
            paper_id,
            status="failed",
            failed_step=current_step,
            progress_message=f"解析在 [{current_step}] 中断，可点击「重新解析」重试",
            error_message=str(exc),
        )
    except Exception as exc:
        logger.exception("Unexpected pipeline error at %s for paper %s", current_step, paper_id)
        _update_paper_progress(
            paper_id,
            status="failed",
            failed_step=current_step,
            progress_message=f"解析异常中断 ({current_step})",
            error_message=str(exc),
        )
    finally:
        gc.collect()


async def _worker_loop() -> None:
    assert _pdf_queue is not None
    logger.info("Single-concurrency PDF worker started.")
    while True:
        paper_id = await _pdf_queue.get()
        try:
            await process_paper_pipeline(paper_id)
        except Exception as exc:
            logger.exception("Worker loop uncaught error for %s: %s", paper_id, exc)
        finally:
            _pdf_queue.task_done()


async def start_worker() -> None:
    global _pdf_queue, _worker_task
    if _pdf_queue is None:
        _pdf_queue = asyncio.Queue()
    if _worker_task is None or _worker_task.done():
        _worker_task = asyncio.create_task(_worker_loop())

    # Re-enqueue any papers left queued or interrupted during a previous shutdown
    db = SessionLocal()
    try:
        pending = (
            db.query(Paper)
            .filter(Paper.status.in_(["queued", "processing"]))
            .order_by(Paper.created_at.asc())
            .all()
        )
        for p in pending:
            p.status = "queued"
            p.progress_message = "服务重启后重新排队解析..."
            await _pdf_queue.put(p.id)
        if pending:
            db.commit()
    finally:
        db.close()


async def stop_worker() -> None:
    global _worker_task
    if _worker_task and not _worker_task.done():
        _worker_task.cancel()
        try:
            await _worker_task
        except asyncio.CancelledError:
            pass
    _worker_task = None


async def enqueue_paper(paper_id: str) -> None:
    global _pdf_queue
    if _pdf_queue is None:
        await start_worker()
    assert _pdf_queue is not None
    await _pdf_queue.put(paper_id)
