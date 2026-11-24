import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import (
    ChatMessage,
    ChatThread,
    Folder,
    Highlight,
    Paper,
    PaperBlock,
    QAAnchor,
)
from app.routers.papers_router import paper_to_out
from app.schemas import (
    ChatMessageOut,
    CreateAnchorQARequest,
    HighlightCreate,
    HighlightOut,
    HighlightUpdate,
    InlineTranslateRequest,
    InlineTranslateSaveRequest,
    PaperBlockOut,
    PaperDetailOut,
    QAAnchorOut,
    ReadingProgressUpdate,
    SynthesisRequest,
    ThreadMessageCreateRequest,
)
from app.services.llm_service import (
    LLMServiceError,
    call_chat_completion,
    resolve_module_config,
)

router = APIRouter(prefix="/api", tags=["reader"])


def _msg_to_out(m: ChatMessage) -> ChatMessageOut:
    return ChatMessageOut(
        id=m.id,
        thread_id=m.thread_id,
        role=m.role,
        content=m.content,
        thinking_content=m.thinking_content,
        thinking_level=m.thinking_level,
        created_at=m.created_at,
    )


def _highlight_to_out(h: Highlight) -> HighlightOut:
    return HighlightOut(
        id=h.id,
        paper_id=h.paper_id,
        block_id=h.block_id,
        lang=h.lang,
        start_offset=h.start_offset,
        end_offset=h.end_offset,
        selected_text=h.selected_text,
        color=h.color,
        note=h.note,
        created_at=h.created_at,
    )


def _anchor_to_out(a: QAAnchor, messages: list[ChatMessage]) -> QAAnchorOut:
    return QAAnchorOut(
        id=a.id,
        paper_id=a.paper_id,
        block_id=a.block_id,
        thread_id=a.thread_id,
        lang=a.lang,
        start_offset=a.start_offset,
        end_offset=a.end_offset,
        selected_text=a.selected_text,
        created_at=a.created_at,
        messages=[_msg_to_out(m) for m in messages],
    )


def _build_paper_context(paper: Paper, blocks: list[PaperBlock], max_chars: int = 16000) -> str:
    parts = [
        f"Title: {paper.title}",
        f"Title (ZH): {paper.title_zh or ''}",
        f"Authors: {', '.join(paper.authors or [])}",
        f"Venue/Year: {paper.venue or 'Unknown'} ({paper.year or ''})",
        f"Abstract: {paper.abstract_en or ''}",
    ]
    used = sum(len(p) for p in parts)
    for b in blocks:
        snippet = ""
        if b.type == "heading":
            snippet = f"\n## {b.en}"
        elif b.type in ("figure", "table"):
            snippet = f"[{b.figure_label or b.type}] {b.caption_en or ''}"
        else:
            snippet = b.en or ""
        if not snippet:
            continue
        if used + len(snippet) > max_chars:
            break
        parts.append(snippet)
        used += len(snippet)
    return "\n".join(parts)


@router.get("/papers/{paper_id}/reader", response_model=PaperDetailOut)
def get_paper_reader_data(
    paper_id: str,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    blocks = (
        db.query(PaperBlock)
        .filter(PaperBlock.paper_id == paper_id)
        .order_by(PaperBlock.order_index.asc())
        .all()
    )
    highlights = (
        db.query(Highlight)
        .filter(Highlight.paper_id == paper_id)
        .order_by(Highlight.created_at.asc())
        .all()
    )
    anchors = (
        db.query(QAAnchor)
        .filter(QAAnchor.paper_id == paper_id)
        .order_by(QAAnchor.created_at.asc())
        .all()
    )

    paper_thread = (
        db.query(ChatThread)
        .filter(ChatThread.paper_id == paper_id, ChatThread.scope == "paper")
        .first()
    )
    if not paper_thread:
        paper_thread = ChatThread(
            id=str(uuid.uuid4()),
            paper_id=paper_id,
            scope="paper",
            title="全文 AI 伴读",
        )
        db.add(paper_thread)
        db.commit()
        db.refresh(paper_thread)

    paper_messages = (
        db.query(ChatMessage)
        .filter(ChatMessage.thread_id == paper_thread.id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )

    anchor_outs: list[QAAnchorOut] = []
    for a in anchors:
        msgs = (
            db.query(ChatMessage)
            .filter(ChatMessage.thread_id == a.thread_id)
            .order_by(ChatMessage.created_at.asc())
            .all()
        )
        anchor_outs.append(_anchor_to_out(a, msgs))

    return PaperDetailOut(
        paper=paper_to_out(paper),
        outline=paper.outline or [],
        references_list=paper.references_list or [],
        blocks=[
            PaperBlockOut(
                id=b.id,
                order_index=b.order_index,
                type=b.type,
                heading_level=b.heading_level,
                section_id=b.section_id,
                page_num=b.page_num,
                en=b.en,
                zh=b.zh,
                figure_url=b.figure_url,
                figure_label=b.figure_label,
                caption_en=b.caption_en,
                caption_zh=b.caption_zh,
                bbox=b.bbox,
            )
            for b in blocks
        ],
        highlights=[_highlight_to_out(h) for h in highlights],
        qa_anchors=anchor_outs,
        paper_thread_id=paper_thread.id,
        paper_messages=[_msg_to_out(m) for m in paper_messages],
    )


@router.put("/papers/{paper_id}/reading-progress")
def update_reading_progress(
    paper_id: str,
    payload: ReadingProgressUpdate,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")
    if payload.reading_progress is not None:
        paper.reading_progress = round(float(payload.reading_progress), 1)
    if payload.last_block_id is not None:
        paper.last_block_id = payload.last_block_id
    if payload.last_page is not None:
        paper.last_page = int(payload.last_page)
    if payload.last_lang_mode is not None:
        paper.last_lang_mode = payload.last_lang_mode
    if payload.last_view_mode is not None:
        paper.last_view_mode = payload.last_view_mode
    db.commit()
    return {
        "ok": True,
        "reading_progress": paper.reading_progress,
        "last_block_id": paper.last_block_id,
        "last_page": paper.last_page,
        "last_lang_mode": paper.last_lang_mode,
        "last_view_mode": paper.last_view_mode,
    }


@router.post("/papers/{paper_id}/translate-selection")
async def translate_selection(
    paper_id: str,
    payload: InlineTranslateRequest,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    blk = (
        db.query(PaperBlock)
        .filter(PaperBlock.id == payload.block_id, PaperBlock.paper_id == paper_id)
        .first()
    )
    cfg = resolve_module_config(db, "translate")

    prompt = (
        f"论文标题: {paper.title}\n"
        f"所在段落上下文: {payload.context_en or (blk.en if blk else '')}\n\n"
        f"请结合上述论文上下文，将以下选定文本精确、地道地翻译为学术中文。"
        "保留所有 LaTeX 公式（$...$）与引用角标（[13]）。仅返回译文本身，不要加多余解释：\n\n"
        f"{payload.selected_text}"
    )

    try:
        translated, _ = await call_chat_completion(
            cfg,
            [{"role": "user", "content": prompt}],
            temperature=0.2,
            max_tokens=1024,
        )
        return {"translation": translated}
    except LLMServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@router.put("/papers/{paper_id}/blocks/{block_id}/translation")
def save_block_translation(
    paper_id: str,
    block_id: str,
    payload: InlineTranslateSaveRequest,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    blk = (
        db.query(PaperBlock)
        .filter(PaperBlock.id == block_id, PaperBlock.paper_id == paper_id)
        .first()
    )
    if not blk:
        raise HTTPException(status_code=404, detail="Block not found")
    if blk.type in ("figure", "table"):
        blk.caption_zh = payload.zh.strip()
    else:
        blk.zh = payload.zh.strip()
    db.commit()
    return {"ok": True, "zh": blk.caption_zh if blk.type in ("figure", "table") else blk.zh}


@router.post("/papers/{paper_id}/highlights", response_model=HighlightOut)
def create_highlight(
    paper_id: str,
    payload: HighlightCreate,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    blk = (
        db.query(PaperBlock)
        .filter(PaperBlock.id == payload.block_id, PaperBlock.paper_id == paper_id)
        .first()
    )
    if not blk:
        raise HTTPException(status_code=404, detail="Block not found")

    existing = (
        db.query(Highlight)
        .filter(
            Highlight.paper_id == paper_id,
            Highlight.block_id == payload.block_id,
            Highlight.lang == payload.lang,
            Highlight.start_offset == payload.start_offset,
            Highlight.end_offset == payload.end_offset,
        )
        .first()
    )
    if existing:
        existing.color = payload.color
        if payload.note is not None and payload.note.strip():
            existing.note = payload.note.strip()
        db.commit()
        db.refresh(existing)
        return _highlight_to_out(existing)

    h = Highlight(
        id=str(uuid.uuid4()),
        paper_id=paper_id,
        block_id=payload.block_id,
        lang=payload.lang,
        start_offset=payload.start_offset,
        end_offset=payload.end_offset,
        selected_text=payload.selected_text,
        color=payload.color,
        note=(payload.note or "").strip() or None,
    )
    db.add(h)
    db.commit()
    db.refresh(h)
    return _highlight_to_out(h)


@router.put("/papers/{paper_id}/highlights/{highlight_id}", response_model=HighlightOut)
def update_highlight(
    paper_id: str,
    highlight_id: str,
    payload: HighlightUpdate,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    h = (
        db.query(Highlight)
        .filter(Highlight.id == highlight_id, Highlight.paper_id == paper_id)
        .first()
    )
    if not h:
        raise HTTPException(status_code=404, detail="Highlight not found")
    if payload.color is not None:
        h.color = payload.color
    if payload.note is not None:
        h.note = payload.note.strip() or None
    db.commit()
    db.refresh(h)
    return _highlight_to_out(h)


@router.delete("/papers/{paper_id}/highlights/{highlight_id}")
def delete_highlight(
    paper_id: str,
    highlight_id: str,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    h = (
        db.query(Highlight)
        .filter(Highlight.id == highlight_id, Highlight.paper_id == paper_id)
        .first()
    )
    if not h:
        raise HTTPException(status_code=404, detail="Highlight not found")
    db.delete(h)
    db.commit()
    return {"ok": True}


@router.post("/papers/{paper_id}/qa-anchors", response_model=QAAnchorOut)
async def create_qa_anchor_and_ask(
    paper_id: str,
    payload: CreateAnchorQARequest,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    """
    Create a persistent QAAnchor + dedicated ChatThread for the highlighted selection,
    run the first AI Explain / Ask question, and persist both user & assistant messages.
    """
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    blk = (
        db.query(PaperBlock)
        .filter(PaperBlock.id == payload.block_id, PaperBlock.paper_id == paper_id)
        .first()
    )
    if not blk:
        raise HTTPException(status_code=404, detail="Block not found")

    blocks = (
        db.query(PaperBlock)
        .filter(PaperBlock.paper_id == paper_id)
        .order_by(PaperBlock.order_index.asc())
        .all()
    )
    cfg = resolve_module_config(db, "chat")
    thinking_level = payload.thinking_level or cfg.thinking_level

    user_question = (
        (payload.question or "").strip()
        if payload.mode == "ask" and (payload.question or "").strip()
        else f"请结合全文语境，深度解析这段选定内容的学术含义、核心机理或数学推导：\n「{payload.selected_text}」"
    )

    paper_ctx = _build_paper_context(paper, blocks, max_chars=12000)
    block_ctx = f"英文段落: {blk.en}\n中文译文: {blk.zh}"
    system_prompt = (
        "你是一位耐心的顶尖学科导师与学术伴读助手。请结合论文全篇脉络和该选区所在段落，用清晰、准确、结构化的中文回答读者的问题。"
        "如涉及公式请使用标准 LaTeX `$...$` 或 `$$...$$`。"
    )
    llm_messages = [
        {"role": "system", "content": system_prompt},
        {
            "role": "user",
            "content": (
                f"【论文上下文摘要与正文节选】:\n{paper_ctx}\n\n"
                f"【选区所在完整段落】:\n{block_ctx}\n\n"
                f"【读者划词选中的内容】:\n{payload.selected_text}\n\n"
                f"【读者问题】:\n{user_question}"
            ),
        },
    ]

    try:
        answer_text, thinking_text = await call_chat_completion(
            cfg,
            llm_messages,
            temperature=0.3,
            max_tokens=4096,
            thinking_level=thinking_level,
        )
    except LLMServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    thread = ChatThread(
        id=str(uuid.uuid4()),
        paper_id=paper_id,
        scope="anchor",
        title=payload.selected_text[:60],
    )
    db.add(thread)
    db.flush()

    anchor = QAAnchor(
        id=str(uuid.uuid4()),
        paper_id=paper_id,
        block_id=payload.block_id,
        thread_id=thread.id,
        lang=payload.lang,
        start_offset=payload.start_offset,
        end_offset=payload.end_offset,
        selected_text=payload.selected_text,
    )
    db.add(anchor)

    user_msg = ChatMessage(
        id=str(uuid.uuid4()),
        thread_id=thread.id,
        role="user",
        content=user_question,
    )
    ai_msg = ChatMessage(
        id=str(uuid.uuid4()),
        thread_id=thread.id,
        role="assistant",
        content=answer_text,
        thinking_content=thinking_text,
        thinking_level=thinking_level,
    )
    db.add_all([user_msg, ai_msg])
    db.commit()
    db.refresh(anchor)

    return _anchor_to_out(anchor, [user_msg, ai_msg])


@router.delete("/qa-anchors/{anchor_id}")
def delete_qa_anchor(
    anchor_id: str,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    anchor = db.query(QAAnchor).filter(QAAnchor.id == anchor_id).first()
    if not anchor:
        raise HTTPException(status_code=404, detail="QA anchor not found")
    thread = db.query(ChatThread).filter(ChatThread.id == anchor.thread_id).first()
    db.delete(anchor)
    if thread:
        db.delete(thread)
    db.commit()
    return {"ok": True}


def _build_paper_annotations_memory(db: Session, paper_id: str, max_chars: int = 5000) -> str:
    """Collect all user highlights, notes, and selection QA anchor histories for one paper."""
    highlights = (
        db.query(Highlight)
        .filter(Highlight.paper_id == paper_id)
        .order_by(Highlight.created_at.asc())
        .all()
    )
    anchors = (
        db.query(QAAnchor)
        .filter(QAAnchor.paper_id == paper_id)
        .order_by(QAAnchor.created_at.asc())
        .all()
    )

    lines: list[str] = []
    if highlights:
        lines.append("【读者在本篇文献中做过的高亮与批注】:")
        for idx, h in enumerate(highlights, start=1):
            note_part = f" | 读者批注: {h.note}" if h.note else ""
            lines.append(f"{idx}. [{h.color}] 选中内容: 「{h.selected_text[:240]}」{note_part}")

    if anchors:
        lines.append("\n【读者在本篇文献中划词发起过的 AI 提问与解答历史】:")
        for idx, a in enumerate(anchors, start=1):
            msgs = (
                db.query(ChatMessage)
                .filter(ChatMessage.thread_id == a.thread_id)
                .order_by(ChatMessage.created_at.asc())
                .all()
            )
            lines.append(f"{idx}. 划词片段: 「{a.selected_text[:220]}」")
            for m in msgs:
                role_label = "读者提问" if m.role == "user" else "AI解答要点"
                lines.append(f"   - {role_label}: {m.content[:320]}")

    out = "\n".join(lines)
    return out[:max_chars] if out else ""


def _build_global_library_memory(db: Session, user_question: str) -> str:
    """Build comprehensive global knowledge memory across all papers, folders, notes, highlights, and QA histories."""
    folders = db.query(Folder).order_by(Folder.sort_order.asc()).all()
    folder_name_map = {f.id: f.name for f in folders}

    papers = db.query(Paper).order_by(Paper.updated_at.desc()).all()
    all_highlights = db.query(Highlight).order_by(Highlight.created_at.asc()).all()
    all_anchors = db.query(QAAnchor).order_by(QAAnchor.created_at.asc()).all()
    all_threads = db.query(ChatThread).filter(ChatThread.scope == "paper").all()

    hl_by_paper: dict[str, list[Highlight]] = {}
    for h in all_highlights:
        hl_by_paper.setdefault(h.paper_id, []).append(h)

    anc_by_paper: dict[str, list[QAAnchor]] = {}
    for a in all_anchors:
        anc_by_paper.setdefault(a.paper_id, []).append(a)

    paper_thread_by_paper = {t.paper_id: t for t in all_threads if t.paper_id}

    sections: list[str] = []
    if folders:
        sections.append("【用户文献库文件夹分类】: " + "、".join(f.name for f in folders))

    if not papers:
        sections.append("【文献库状态】: 当前文献库为空，尚未导入任何论文。")
        return "\n\n".join(sections)

    sections.append(f"【用户个人文献库全览（共 {len(papers)} 篇文献）】:")
    q_low = (user_question or "").lower()
    matched_deep_papers: list[Paper] = []

    for idx, p in enumerate(papers, start=1):
        fname = folder_name_map.get(p.folder_id, "未分类") if p.folder_id else "未分类"
        title_display = f"{p.title_zh} ({p.title})" if p.title_zh else p.title
        tiers = ", ".join(p.journal_tier or []) or "无分区标签"
        p_lines = [
            f"### 文献 {idx}: 《{title_display}》",
            f"- 文件夹: {fname} | 年份: {p.year or '未知'} | 期刊/会议: {p.venue or '未知'} | 分区: {tiers} | 阅读进度: {round(p.reading_progress or 0)}%",
        ]
        if p.authors:
            p_lines.append(f"- 作者: {', '.join(p.authors[:6])}")
        abs_txt = (p.abstract_zh or p.abstract_en or "").strip()
        if abs_txt:
            p_lines.append(f"- 摘要: {abs_txt[:420]}")

        # Highlights & Notes for this paper
        hls = hl_by_paper.get(p.id, [])
        if hls:
            p_lines.append(f"- 读者高亮与批注 ({len(hls)} 条):")
            for h in hls[:25]:
                note_s = f" → 【批注】: {h.note}" if h.note else ""
                p_lines.append(f"  * [{h.color}] 「{h.selected_text[:180]}」{note_s}")

        # Selection QA anchors for this paper
        ancs = anc_by_paper.get(p.id, [])
        if ancs:
            p_lines.append(f"- 读者划词 AI 提问记录 ({len(ancs)} 处，反映读者重点疑惑或关注点):")
            for a in ancs[:18]:
                msgs = (
                    db.query(ChatMessage)
                    .filter(ChatMessage.thread_id == a.thread_id)
                    .order_by(ChatMessage.created_at.asc())
                    .all()
                )
                user_qs = [m.content[:180] for m in msgs if m.role == "user"]
                ai_ans = [m.content[:220] for m in msgs if m.role == "assistant"]
                q_str = " / ".join(user_qs) if user_qs else "请求 AI 深度解释"
                a_str = ai_ans[-1] if ai_ans else ""
                p_lines.append(f"  * 划词: 「{a.selected_text[:150]}」 | 问: {q_str} | 答要: {a_str}")

        # Paper-level chat questions
        pt = paper_thread_by_paper.get(p.id)
        if pt:
            p_msgs = (
                db.query(ChatMessage)
                .filter(ChatMessage.thread_id == pt.id, ChatMessage.role == "user")
                .order_by(ChatMessage.created_at.desc())
                .limit(6)
                .all()
            )
            if p_msgs:
                p_lines.append(
                    "- 读者在该文献的全文伴读中曾提问: "
                    + "；".join(m.content[:120] for m in reversed(p_msgs))
                )

        sections.append("\n".join(p_lines))

        # Check if user's question specifically references this paper so we can include deeper body text
        title_tokens = [
            t.lower()
            for t in [p.title_zh or "", p.title or "", p.venue or ""]
            if t and len(t) >= 3
        ]
        if any(
            tok[:8] in q_low or any(w in q_low for w in tok.split() if len(w) >= 4)
            for tok in title_tokens
        ):
            matched_deep_papers.append(p)

    # Inject deep body excerpts for up to 2 specifically referenced papers
    if matched_deep_papers:
        sections.append("\n【与当前提问高度相关文献的正文节选】:")
        for mp in matched_deep_papers[:2]:
            blks = (
                db.query(PaperBlock)
                .filter(PaperBlock.paper_id == mp.id)
                .order_by(PaperBlock.order_index.asc())
                .limit(35)
                .all()
            )
            sections.append(_build_paper_context(mp, blks, max_chars=4500))

    full_ctx = "\n\n".join(sections)
    return full_ctx[:22000]


@router.post("/threads/{thread_id}/messages")
async def post_thread_message(
    thread_id: str,
    payload: ThreadMessageCreateRequest,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = db.query(ChatThread).filter(ChatThread.id == thread_id).first()
    if not thread:
        raise HTTPException(status_code=404, detail="Chat thread not found")

    cfg = resolve_module_config(db, "chat")
    thinking_level = payload.thinking_level or cfg.thinking_level

    history = (
        db.query(ChatMessage)
        .filter(ChatMessage.thread_id == thread_id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )

    context_sections: list[str] = []
    if thread.scope == "synthesis" and thread.paper_ids:
        papers = db.query(Paper).filter(Paper.id.in_(thread.paper_ids)).all()
        for idx, p in enumerate(papers, start=1):
            blks = (
                db.query(PaperBlock)
                .filter(PaperBlock.paper_id == p.id)
                .order_by(PaperBlock.order_index.asc())
                .limit(24)
                .all()
            )
            context_sections.append(f"=== 文献 {idx} ===\n" + _build_paper_context(p, blks, max_chars=4500))
    elif thread.paper_id:
        paper = db.query(Paper).filter(Paper.id == thread.paper_id).first()
        if paper:
            blks = (
                db.query(PaperBlock)
                .filter(PaperBlock.paper_id == paper.id)
                .order_by(PaperBlock.order_index.asc())
                .all()
            )
            context_sections.append(_build_paper_context(paper, blks, max_chars=13000))
            ann_mem = _build_paper_annotations_memory(db, paper.id, max_chars=4500)
            if ann_mem:
                context_sections.append(ann_mem)
            if thread.scope == "anchor" and thread.anchor:
                anchor = thread.anchor
                blk = db.query(PaperBlock).filter(PaperBlock.id == anchor.block_id).first()
                context_sections.append(
                    f"【当前讨论的划词锚点原文】:\n{anchor.selected_text}\n"
                    f"【所属段落】:\n{blk.en if blk else ''}"
                )

    system_prompt = (
        "你是一个严谨、深入的 AI 学术阅读助手。你同时掌握这篇论文的完整内容，以及读者在本篇论文中做过的所有高亮、批注和划词 AI 问答历史。"
        "请基于这些真实资料回答读者问题（包括梳理批注待办、总结读者不懂的难点、深化论文理解等），条理清晰、直指本质，"
        "引用具体章节、图表依据或读者的原批注，数学公式请使用标准 LaTeX (`$...$` / `$$...$$`)。"
    )

    llm_messages: list[dict[str, str]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "以下是可供参考的论文背景资料：\n\n" + "\n\n".join(context_sections)},
        {"role": "assistant", "content": "已阅览上述论文资料，请提出您的研究问题。"},
    ]
    for msg in history[-12:]:
        llm_messages.append({"role": msg.role, "content": msg.content})
    llm_messages.append({"role": "user", "content": payload.question.strip()})

    try:
        answer_text, thinking_text = await call_chat_completion(
            cfg,
            llm_messages,
            temperature=0.3,
            max_tokens=4096,
            thinking_level=thinking_level,
        )
    except LLMServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    user_msg = ChatMessage(
        id=str(uuid.uuid4()),
        thread_id=thread_id,
        role="user",
        content=payload.question.strip(),
    )
    ai_msg = ChatMessage(
        id=str(uuid.uuid4()),
        thread_id=thread_id,
        role="assistant",
        content=answer_text,
        thinking_content=thinking_text,
        thinking_level=thinking_level,
    )
    db.add_all([user_msg, ai_msg])
    db.commit()

    return {
        "user_message": _msg_to_out(user_msg),
        "assistant_message": _msg_to_out(ai_msg),
    }


@router.post("/synthesis")
async def create_multi_paper_synthesis(
    payload: SynthesisRequest,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    papers = db.query(Paper).filter(Paper.id.in_(payload.paper_ids)).all()
    if len(papers) < 2:
        raise HTTPException(status_code=400, detail="请至少选择 2 篇文献以生成联合综述报告")

    cfg = resolve_module_config(db, "chat")
    thinking_level = payload.thinking_level or cfg.thinking_level

    docs_ctx: list[str] = []
    titles_summary: list[str] = []
    for idx, p in enumerate(papers, start=1):
        titles_summary.append(f"[{idx}] {p.title} ({p.year or 'N/A'}, {p.venue or 'N/A'})")
        blks = (
            db.query(PaperBlock)
            .filter(PaperBlock.paper_id == p.id)
            .order_by(PaperBlock.order_index.asc())
            .limit(28)
            .all()
        )
        docs_ctx.append(f"=== 文献 [{idx}] ===\n" + _build_paper_context(p, blks, max_chars=4500))

    question = (payload.question or "").strip() or (
        "请基于以上选中的多篇学术文献，撰写一份深度结构化文献综述报告，包含：\n"
        "1. 研究脉络与核心问题对比（用 Markdown 表格总结各篇的方法、数据集、指标与贡献）；\n"
        "2. 技术路线演进与内在联系；\n"
        "3. 各篇局限性对比与未来可行的研究突破口。"
    )

    llm_messages = [
        {
            "role": "system",
            "content": "你是一位撰写高水平 Survey / 文献综述的研究员。请基于真实文献内容进行横向对比、综合研判，严禁编造数据。",
        },
        {
            "role": "user",
            "content": "选定文献清单：\n"
            + "\n".join(titles_summary)
            + "\n\n文献详情：\n"
            + "\n\n".join(docs_ctx)
            + f"\n\n【综述要求】:\n{question}",
        },
    ]

    try:
        answer_text, thinking_text = await call_chat_completion(
            cfg,
            llm_messages,
            temperature=0.3,
            max_tokens=4096,
            thinking_level=thinking_level,
            timeout_sec=180.0,
        )
    except LLMServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    thread = ChatThread(
        id=str(uuid.uuid4()),
        paper_id=papers[0].id,
        scope="synthesis",
        title=f"多篇综述 ({len(papers)} 篇)",
        paper_ids=[p.id for p in papers],
    )
    db.add(thread)
    db.flush()

    user_msg = ChatMessage(
        id=str(uuid.uuid4()),
        thread_id=thread.id,
        role="user",
        content=question,
    )
    ai_msg = ChatMessage(
        id=str(uuid.uuid4()),
        thread_id=thread.id,
        role="assistant",
        content=answer_text,
        thinking_content=thinking_text,
        thinking_level=thinking_level,
    )
    db.add_all([user_msg, ai_msg])
    db.commit()

    return {
        "thread_id": thread.id,
        "title": thread.title,
        "messages": [_msg_to_out(user_msg), _msg_to_out(ai_msg)],
    }


def _get_or_create_global_thread(db: Session) -> ChatThread:
    thread = db.query(ChatThread).filter(ChatThread.scope == "global").first()
    if not thread:
        thread = ChatThread(
            id=str(uuid.uuid4()),
            paper_id=None,
            scope="global",
            title="全局文献库 AI 助手",
        )
        db.add(thread)
        db.commit()
        db.refresh(thread)
    return thread


@router.get("/global-chat")
def get_global_chat(
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = _get_or_create_global_thread(db)
    msgs = (
        db.query(ChatMessage)
        .filter(ChatMessage.thread_id == thread.id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )
    paper_count = db.query(Paper).count()
    highlight_count = db.query(Highlight).count()
    note_count = (
        db.query(Highlight)
        .filter(Highlight.note.isnot(None), Highlight.note != "")
        .count()
    )
    anchor_count = db.query(QAAnchor).count()
    return {
        "thread_id": thread.id,
        "messages": [_msg_to_out(m) for m in msgs],
        "stats": {
            "paper_count": paper_count,
            "highlight_count": highlight_count,
            "note_count": note_count,
            "anchor_count": anchor_count,
        },
    }


@router.post("/global-chat/messages")
async def post_global_chat_message(
    payload: ThreadMessageCreateRequest,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = _get_or_create_global_thread(db)
    cfg = resolve_module_config(db, "chat")
    thinking_level = payload.thinking_level or cfg.thinking_level

    history = (
        db.query(ChatMessage)
        .filter(ChatMessage.thread_id == thread.id)
        .order_by(ChatMessage.created_at.asc())
        .all()
    )
    global_memory = _build_global_library_memory(db, payload.question)

    system_prompt = (
        "你是用户的个人全局学术知识库 AI 助手（H文献大师全局大脑）。"
        "你可以读取用户整个文献库中的所有论文信息、阅读进度、所有高亮与亲手写的批注、以及用户在各篇论文中划词发起过的所有 AI 提问与解答历史。"
        "你既能精准回答关于用户文献库、批注待办、阅读盲区/不懂的地方、跨文献对比与知识关联的问题，也能作为通用学术助手解答任何科研问题。"
        "回答时请清晰标明引用的具体文献名称与用户的原批注/提问，严禁凭空编造用户没写过的批注，数学公式请使用标准 LaTeX (`$...$` / `$$...$$`)。"
    )

    llm_messages: list[dict[str, str]] = [
        {"role": "system", "content": system_prompt},
        {"role": "user", "content": "以下是我个人文献库的实时全量知识与阅读记忆：\n\n" + global_memory},
        {"role": "assistant", "content": "已同步查阅您的全部文献、高亮批注及历史提问记录，请问有什么可以帮您？"},
    ]
    for msg in history[-12:]:
        llm_messages.append({"role": msg.role, "content": msg.content})
    llm_messages.append({"role": "user", "content": payload.question.strip()})

    try:
        answer_text, thinking_text = await call_chat_completion(
            cfg,
            llm_messages,
            temperature=0.3,
            max_tokens=4096,
            thinking_level=thinking_level,
            timeout_sec=150.0,
        )
    except LLMServiceError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc

    user_msg = ChatMessage(
        id=str(uuid.uuid4()),
        thread_id=thread.id,
        role="user",
        content=payload.question.strip(),
    )
    ai_msg = ChatMessage(
        id=str(uuid.uuid4()),
        thread_id=thread.id,
        role="assistant",
        content=answer_text,
        thinking_content=thinking_text,
        thinking_level=thinking_level,
    )
    db.add_all([user_msg, ai_msg])
    db.commit()

    return {
        "user_message": _msg_to_out(user_msg),
        "assistant_message": _msg_to_out(ai_msg),
    }


@router.delete("/global-chat/messages")
def clear_global_chat_messages(
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    thread = _get_or_create_global_thread(db)
    db.query(ChatMessage).filter(ChatMessage.thread_id == thread.id).delete()
    db.commit()
    return {"ok": True}
