import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.models import (
    ChatMessage,
    ChatThread,
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
            context_sections.append(_build_paper_context(paper, blks, max_chars=14000))
            if thread.scope == "anchor" and thread.anchor:
                anchor = thread.anchor
                blk = db.query(PaperBlock).filter(PaperBlock.id == anchor.block_id).first()
                context_sections.append(
                    f"【当前讨论的划词锚点原文】:\n{anchor.selected_text}\n"
                    f"【所属段落】:\n{blk.en if blk else ''}"
                )

    system_prompt = (
        "你是一个严谨、深入的 AI 学术阅读助手。请基于提供的论文内容回答读者问题，条理清晰、直指本质，"
        "引用具体章节或图表依据（如 Fig. 1），数学公式请使用标准 LaTeX (`$...$` / `$$...$$`)。"
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
