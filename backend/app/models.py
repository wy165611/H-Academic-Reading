import uuid
from datetime import datetime, timezone

from sqlalchemy import (
    Column,
    DateTime,
    Float,
    ForeignKey,
    Integer,
    JSON,
    String,
    Text,
    UniqueConstraint,
)
from sqlalchemy.orm import relationship

from app.database import Base


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


def gen_uuid() -> str:
    return str(uuid.uuid4())


class SystemSetting(Base):
    __tablename__ = "system_settings"

    id = Column(Integer, primary_key=True, default=1)
    global_base_url = Column(String(512), nullable=False)
    global_api_key = Column(String(512), nullable=False, default="")

    ocr_model = Column(String(256), nullable=False, default="qwen3.5-ocr")
    ocr_base_url = Column(String(512), nullable=True)
    ocr_api_key = Column(String(512), nullable=True)

    translate_model = Column(String(256), nullable=False, default="deepseek-v4.1-flash-1017")
    translate_base_url = Column(String(512), nullable=True)
    translate_api_key = Column(String(512), nullable=True)

    chat_model = Column(String(256), nullable=False, default="deepseek-v4.1-flash-1017")
    chat_base_url = Column(String(512), nullable=True)
    chat_api_key = Column(String(512), nullable=True)
    chat_thinking_level = Column(String(32), nullable=False, default="high")

    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)


class Folder(Base):
    __tablename__ = "folders"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    name = Column(String(128), nullable=False)
    parent_id = Column(String(64), ForeignKey("folders.id", ondelete="CASCADE"), nullable=True)
    sort_order = Column(Integer, nullable=False, default=0)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    papers = relationship("Paper", back_populates="folder")


class Paper(Base):
    __tablename__ = "papers"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    folder_id = Column(String(64), ForeignKey("folders.id", ondelete="SET NULL"), nullable=True)

    title = Column(String(512), nullable=False)
    title_zh = Column(String(512), nullable=True)
    authors = Column(JSON, nullable=False, default=list)
    year = Column(Integer, nullable=True)
    venue = Column(String(256), nullable=True)
    issn = Column(String(64), nullable=True)
    doi = Column(String(256), nullable=True)
    arxiv_id = Column(String(64), nullable=True)

    abstract_en = Column(Text, nullable=True)
    abstract_zh = Column(Text, nullable=True)
    journal_tier = Column(JSON, nullable=False, default=list)

    status = Column(String(32), nullable=False, default="queued")
    progress = Column(Integer, nullable=False, default=0)
    progress_message = Column(String(256), nullable=False, default="等待进入解析队列...")
    failed_step = Column(String(64), nullable=True)
    error_message = Column(Text, nullable=True)

    page_count = Column(Integer, nullable=False, default=0)
    pdf_filename = Column(String(256), nullable=False)
    thumbnail_url = Column(String(512), nullable=True)
    source_url = Column(String(1024), nullable=True)

    outline = Column(JSON, nullable=False, default=list)
    references_list = Column(JSON, nullable=False, default=list)

    reading_progress = Column(Float, nullable=False, default=0.0)
    last_block_id = Column(String(64), nullable=True)
    last_page = Column(Integer, nullable=False, default=1)
    last_lang_mode = Column(String(16), nullable=False, default="zh")
    last_view_mode = Column(String(16), nullable=False, default="stream")

    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    folder = relationship("Folder", back_populates="papers")
    blocks = relationship(
        "PaperBlock",
        back_populates="paper",
        cascade="all, delete-orphan",
        order_by="PaperBlock.order_index",
    )
    highlights = relationship(
        "Highlight", back_populates="paper", cascade="all, delete-orphan"
    )
    qa_anchors = relationship(
        "QAAnchor", back_populates="paper", cascade="all, delete-orphan"
    )
    chat_threads = relationship(
        "ChatThread", back_populates="paper", cascade="all, delete-orphan"
    )


class PaperBlock(Base):
    __tablename__ = "paper_blocks"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    paper_id = Column(
        String(64), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    order_index = Column(Integer, nullable=False, index=True)
    type = Column(String(32), nullable=False, default="paragraph")
    heading_level = Column(Integer, nullable=True)
    section_id = Column(String(64), nullable=True)
    page_num = Column(Integer, nullable=False, default=1)

    en = Column(Text, nullable=False, default="")
    zh = Column(Text, nullable=False, default="")

    figure_url = Column(String(512), nullable=True)
    figure_label = Column(String(128), nullable=True)
    caption_en = Column(Text, nullable=True)
    caption_zh = Column(Text, nullable=True)
    bbox = Column(JSON, nullable=True)

    paper = relationship("Paper", back_populates="blocks")


class Highlight(Base):
    __tablename__ = "highlights"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    paper_id = Column(
        String(64), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    block_id = Column(
        String(64), ForeignKey("paper_blocks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    lang = Column(String(8), nullable=False, default="en")
    start_offset = Column(Integer, nullable=False)
    end_offset = Column(Integer, nullable=False)
    selected_text = Column(Text, nullable=False)
    color = Column(String(32), nullable=False, default="mauve")
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    paper = relationship("Paper", back_populates="highlights")


class ChatThread(Base):
    __tablename__ = "chat_threads"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    paper_id = Column(
        String(64), ForeignKey("papers.id", ondelete="CASCADE"), nullable=True, index=True
    )
    scope = Column(String(32), nullable=False, default="paper")
    title = Column(String(256), nullable=False, default="全文 AI 伴读")
    paper_ids = Column(JSON, nullable=False, default=list)
    created_at = Column(DateTime(timezone=True), default=utcnow)
    updated_at = Column(DateTime(timezone=True), default=utcnow, onupdate=utcnow)

    paper = relationship("Paper", back_populates="chat_threads")
    anchor = relationship(
        "QAAnchor", back_populates="thread", uselist=False, cascade="all, delete-orphan"
    )
    messages = relationship(
        "ChatMessage",
        back_populates="thread",
        cascade="all, delete-orphan",
        order_by="ChatMessage.created_at",
    )


class QAAnchor(Base):
    __tablename__ = "qa_anchors"
    __table_args__ = (UniqueConstraint("thread_id", name="uq_qa_anchor_thread"),)

    id = Column(String(64), primary_key=True, default=gen_uuid)
    paper_id = Column(
        String(64), ForeignKey("papers.id", ondelete="CASCADE"), nullable=False, index=True
    )
    block_id = Column(
        String(64), ForeignKey("paper_blocks.id", ondelete="CASCADE"), nullable=False, index=True
    )
    thread_id = Column(
        String(64), ForeignKey("chat_threads.id", ondelete="CASCADE"), nullable=False
    )
    lang = Column(String(8), nullable=False, default="en")
    start_offset = Column(Integer, nullable=False)
    end_offset = Column(Integer, nullable=False)
    selected_text = Column(Text, nullable=False)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    paper = relationship("Paper", back_populates="qa_anchors")
    thread = relationship("ChatThread", back_populates="anchor")


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id = Column(String(64), primary_key=True, default=gen_uuid)
    thread_id = Column(
        String(64), ForeignKey("chat_threads.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role = Column(String(16), nullable=False)
    content = Column(Text, nullable=False)
    thinking_content = Column(Text, nullable=True)
    thinking_level = Column(String(32), nullable=True)
    created_at = Column(DateTime(timezone=True), default=utcnow)

    thread = relationship("ChatThread", back_populates="messages")
