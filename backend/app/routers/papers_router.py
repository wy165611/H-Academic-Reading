import re
import uuid
from pathlib import Path
from typing import Optional

import fitz
import httpx
from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile
from sqlalchemy import desc
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.config import settings
from app.database import get_db
from app.models import ChatThread, Paper, PaperBlock
from app.schemas import PaperFromUrlRequest, PaperOut, PaperUpdateRequest
from app.services.pdf_worker import enqueue_paper

router = APIRouter(prefix="/api/papers", tags=["papers"])


def paper_to_out(p: Paper) -> PaperOut:
    return PaperOut(
        id=p.id,
        folder_id=p.folder_id,
        title=p.title,
        title_zh=p.title_zh,
        authors=p.authors or [],
        year=p.year,
        venue=p.venue,
        issn=p.issn,
        doi=p.doi,
        arxiv_id=p.arxiv_id,
        abstract_en=p.abstract_en,
        abstract_zh=p.abstract_zh,
        journal_tier=p.journal_tier or [],
        status=p.status,
        progress=p.progress,
        progress_message=p.progress_message,
        failed_step=p.failed_step,
        error_message=p.error_message,
        page_count=p.page_count,
        pdf_url=f"/api/files/pdfs/{p.pdf_filename}",
        thumbnail_url=p.thumbnail_url,
        source_url=p.source_url,
        created_at=p.created_at,
        updated_at=p.updated_at,
    )


def _quick_generate_thumbnail(pdf_path: Path, paper_id: str) -> tuple[int, Optional[str]]:
    doc = fitz.open(str(pdf_path))
    try:
        page_count = len(doc)
        thumb_url = None
        if page_count > 0:
            pix = doc[0].get_pixmap(dpi=110, alpha=False)
            thumb_name = f"{paper_id}.png"
            pix.save(str(settings.thumbnails_dir / thumb_name))
            thumb_url = f"/api/files/thumbnails/{thumb_name}"
            del pix
        return page_count, thumb_url
    finally:
        doc.close()


def _normalize_pdf_url(raw_url: str) -> str:
    url = raw_url.strip()
    m = re.match(r"^https?://arxiv\.org/abs/([0-9]+\.[0-9]+(?:v\d+)?)(?:\?.*)?$", url)
    if m:
        return f"https://arxiv.org/pdf/{m.group(1)}.pdf"
    m_old = re.match(r"^https?://arxiv\.org/abs/([a-z\-]+/[0-9]+)(?:\?.*)?$", url)
    if m_old:
        return f"https://arxiv.org/pdf/{m_old.group(1)}.pdf"
    return url


@router.get("", response_model=list[PaperOut])
def list_papers(
    folder_id: Optional[str] = Query(default=None),
    q: Optional[str] = Query(default=None),
    tier: Optional[str] = Query(default=None),
    status: Optional[str] = Query(default=None),
    sort: str = Query(default="created_at"),
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    query = db.query(Paper)

    if folder_id == "uncategorized":
        query = query.filter(Paper.folder_id.is_(None))
    elif folder_id and folder_id != "all":
        query = query.filter(Paper.folder_id == folder_id)

    if status and status != "all":
        query = query.filter(Paper.status == status)

    if sort == "year":
        query = query.order_by(desc(Paper.year), desc(Paper.created_at))
    elif sort == "title":
        query = query.order_by(Paper.title.asc())
    else:
        query = query.order_by(desc(Paper.created_at))

    papers = query.all()

    if q and q.strip():
        needle = q.strip().lower()
        filtered = []
        for p in papers:
            haystack = " ".join(
                [
                    p.title or "",
                    p.title_zh or "",
                    " ".join(p.authors or []),
                    p.venue or "",
                    p.abstract_en or "",
                    p.abstract_zh or "",
                ]
            ).lower()
            if needle in haystack:
                filtered.append(p)
        papers = filtered

    if tier and tier != "all":
        t_low = tier.lower()
        papers = [
            p
            for p in papers
            if any(t_low in str(tag).lower() for tag in (p.journal_tier or []))
        ]

    return [paper_to_out(p) for p in papers]


@router.post("/upload", response_model=list[PaperOut])
async def upload_pdfs(
    files: list[UploadFile] = File(...),
    folder_id: Optional[str] = Form(default=None),
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    created_papers: list[Paper] = []

    for upload in files:
        filename = upload.filename or "document.pdf"
        if not filename.lower().endswith(".pdf"):
            raise HTTPException(status_code=400, detail=f"仅支持 PDF 文件: {filename}")

        raw_bytes = await upload.read()
        if len(raw_bytes) > max_bytes:
            raise HTTPException(
                status_code=400,
                detail=f"文件过大 ({filename})，上限 {settings.MAX_UPLOAD_MB} MB",
            )
        if not raw_bytes.startswith(b"%PDF"):
            raise HTTPException(status_code=400, detail=f"无效的 PDF 文件头: {filename}")

        paper_id = str(uuid.uuid4())
        pdf_filename = f"{paper_id}.pdf"
        pdf_path = settings.pdfs_dir / pdf_filename
        pdf_path.write_bytes(raw_bytes)

        try:
            page_count, thumb_url = _quick_generate_thumbnail(pdf_path, paper_id)
        except Exception:
            pdf_path.unlink(missing_ok=True)
            raise HTTPException(status_code=400, detail=f"无法读取 PDF 页面: {filename}")

        clean_title = Path(filename).stem.replace("_", " ").replace("-", " ").strip() or "Untitled"
        paper = Paper(
            id=paper_id,
            folder_id=folder_id or None,
            title=clean_title,
            pdf_filename=pdf_filename,
            page_count=page_count,
            thumbnail_url=thumb_url,
            status="queued",
            progress=2,
            progress_message="已上传，等待进入单并发解析队列...",
        )
        db.add(paper)
        db.flush()
        db.add(
            ChatThread(
                id=str(uuid.uuid4()),
                paper_id=paper.id,
                scope="paper",
                title="全文 AI 伴读",
            )
        )
        created_papers.append(paper)

    db.commit()
    for p in created_papers:
        db.refresh(p)
        await enqueue_paper(p.id)

    return [paper_to_out(p) for p in created_papers]


@router.post("/url", response_model=PaperOut)
async def import_paper_from_url(
    payload: PaperFromUrlRequest,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    target_url = _normalize_pdf_url(payload.url)
    if not target_url.startswith(("http://", "https://")):
        raise HTTPException(status_code=400, detail="请输入合法的 HTTP/HTTPS 链接或 arXiv 链接")

    max_bytes = settings.MAX_UPLOAD_MB * 1024 * 1024
    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=60.0) as client:
            resp = await client.get(
                target_url,
                headers={"User-Agent": "ScholareadSelfHosted/1.0 (Academic Reader)"},
            )
            if resp.status_code >= 400:
                raise HTTPException(
                    status_code=400,
                    detail=f"远程链接下载失败 (HTTP {resp.status_code})",
                )
            content = resp.content
    except HTTPException:
        raise
    except Exception as exc:
        raise HTTPException(status_code=400, detail=f"抓取链接失败: {exc}") from exc

    if len(content) > max_bytes:
        raise HTTPException(status_code=400, detail=f"远程 PDF 超过 {settings.MAX_UPLOAD_MB} MB 限制")
    if not content[:1024].lstrip().startswith(b"%PDF"):
        raise HTTPException(status_code=400, detail="目标链接返回的不是有效的 PDF 文档")

    paper_id = str(uuid.uuid4())
    pdf_filename = f"{paper_id}.pdf"
    pdf_path = settings.pdfs_dir / pdf_filename
    pdf_path.write_bytes(content)

    try:
        page_count, thumb_url = _quick_generate_thumbnail(pdf_path, paper_id)
    except Exception:
        pdf_path.unlink(missing_ok=True)
        raise HTTPException(status_code=400, detail="下载的 PDF 无法解析")

    guessed_name = target_url.split("/")[-1].split("?")[0]
    if guessed_name.lower().endswith(".pdf"):
        guessed_name = guessed_name[:-4]
    paper = Paper(
        id=paper_id,
        folder_id=payload.folder_id or None,
        title=guessed_name or "Imported PDF",
        pdf_filename=pdf_filename,
        page_count=page_count,
        thumbnail_url=thumb_url,
        source_url=payload.url.strip(),
        status="queued",
        progress=2,
        progress_message="链接已抓取，等待进入解析队列...",
    )
    db.add(paper)
    db.flush()
    db.add(
        ChatThread(
            id=str(uuid.uuid4()),
            paper_id=paper.id,
            scope="paper",
            title="全文 AI 伴读",
        )
    )
    db.commit()
    db.refresh(paper)

    await enqueue_paper(paper.id)
    return paper_to_out(paper)


@router.put("/{paper_id}", response_model=PaperOut)
def update_paper(
    paper_id: str,
    payload: PaperUpdateRequest,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    if payload.clear_folder:
        paper.folder_id = None
    elif payload.folder_id is not None:
        paper.folder_id = payload.folder_id or None

    if payload.title is not None:
        paper.title = payload.title.strip() or paper.title
    if payload.title_zh is not None:
        paper.title_zh = payload.title_zh.strip() or None
    if payload.authors is not None:
        paper.authors = payload.authors
    if payload.year is not None:
        paper.year = payload.year
    if payload.venue is not None:
        paper.venue = payload.venue.strip() or None
    if payload.doi is not None:
        paper.doi = payload.doi.strip() or None
    if payload.abstract_en is not None:
        paper.abstract_en = payload.abstract_en.strip() or None
    if payload.abstract_zh is not None:
        paper.abstract_zh = payload.abstract_zh.strip() or None
    if payload.journal_tier is not None:
        paper.journal_tier = payload.journal_tier

    db.commit()
    db.refresh(paper)
    return paper_to_out(paper)


@router.post("/{paper_id}/reparse", response_model=PaperOut)
async def reparse_paper(
    paper_id: str,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    # Clean old extracted figures for this paper before re-parsing
    for fig_file in settings.figures_dir.glob(f"{paper_id}_*"):
        fig_file.unlink(missing_ok=True)

    paper.status = "queued"
    paper.progress = 2
    paper.progress_message = "已加入重新解析队列..."
    paper.failed_step = None
    paper.error_message = None
    db.commit()
    db.refresh(paper)

    await enqueue_paper(paper.id)
    return paper_to_out(paper)


@router.delete("/{paper_id}")
def delete_paper(
    paper_id: str,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    paper = db.query(Paper).filter(Paper.id == paper_id).first()
    if not paper:
        raise HTTPException(status_code=404, detail="Paper not found")

    pdf_path = settings.pdfs_dir / paper.pdf_filename
    pdf_path.unlink(missing_ok=True)
    thumb_path = settings.thumbnails_dir / f"{paper_id}.png"
    thumb_path.unlink(missing_ok=True)
    for fig_file in settings.figures_dir.glob(f"{paper_id}_*"):
        fig_file.unlink(missing_ok=True)

    db.delete(paper)
    db.commit()
    return {"ok": True}
