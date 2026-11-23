from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    username: str


class SystemSettingOut(BaseModel):
    global_base_url: str
    global_api_key_masked: str
    has_global_api_key: bool

    ocr_model: str
    ocr_base_url: Optional[str] = None
    ocr_api_key_masked: str = ""
    has_ocr_api_key: bool = False

    translate_model: str
    translate_base_url: Optional[str] = None
    translate_api_key_masked: str = ""
    has_translate_api_key: bool = False

    chat_model: str
    chat_base_url: Optional[str] = None
    chat_api_key_masked: str = ""
    has_chat_api_key: bool = False
    chat_thinking_level: Literal["low", "medium", "high"] = "high"


class SystemSettingUpdate(BaseModel):
    global_base_url: Optional[str] = None
    global_api_key: Optional[str] = None

    ocr_model: Optional[str] = None
    ocr_base_url: Optional[str] = None
    ocr_api_key: Optional[str] = None

    translate_model: Optional[str] = None
    translate_base_url: Optional[str] = None
    translate_api_key: Optional[str] = None

    chat_model: Optional[str] = None
    chat_base_url: Optional[str] = None
    chat_api_key: Optional[str] = None
    chat_thinking_level: Optional[Literal["low", "medium", "high"]] = None


class SettingTestRequest(BaseModel):
    module: Literal["ocr", "translate", "chat"]
    base_url: Optional[str] = None
    api_key: Optional[str] = None
    model: Optional[str] = None
    thinking_level: Optional[Literal["low", "medium", "high"]] = None


class FolderCreate(BaseModel):
    name: str = Field(min_length=1, max_length=128)
    parent_id: Optional[str] = None


class FolderUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=128)
    parent_id: Optional[str] = None
    sort_order: Optional[int] = None


class FolderOut(BaseModel):
    id: str
    name: str
    parent_id: Optional[str] = None
    sort_order: int
    paper_count: int = 0
    created_at: datetime


class PaperFromUrlRequest(BaseModel):
    url: str
    folder_id: Optional[str] = None


class PaperUpdateRequest(BaseModel):
    folder_id: Optional[str] = None
    clear_folder: bool = False
    title: Optional[str] = None
    title_zh: Optional[str] = None
    authors: Optional[list[str]] = None
    year: Optional[int] = None
    venue: Optional[str] = None
    doi: Optional[str] = None
    abstract_en: Optional[str] = None
    abstract_zh: Optional[str] = None
    journal_tier: Optional[list[str]] = None


class PaperOut(BaseModel):
    id: str
    folder_id: Optional[str] = None
    title: str
    title_zh: Optional[str] = None
    authors: list[str] = []
    year: Optional[int] = None
    venue: Optional[str] = None
    issn: Optional[str] = None
    doi: Optional[str] = None
    arxiv_id: Optional[str] = None
    abstract_en: Optional[str] = None
    abstract_zh: Optional[str] = None
    journal_tier: list[str] = []
    status: str
    progress: int
    progress_message: str
    failed_step: Optional[str] = None
    error_message: Optional[str] = None
    page_count: int
    pdf_url: str
    thumbnail_url: Optional[str] = None
    source_url: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class PaperBlockOut(BaseModel):
    id: str
    order_index: int
    type: str
    heading_level: Optional[int] = None
    section_id: Optional[str] = None
    page_num: int
    en: str
    zh: str
    figure_url: Optional[str] = None
    figure_label: Optional[str] = None
    caption_en: Optional[str] = None
    caption_zh: Optional[str] = None
    bbox: Optional[list[float]] = None


HighlightColor = Literal[
    "yellow",
    "green",
    "blue",
    "pink",
    "orange",
    "purple",
    "amber",
    "mauve",
    "sage",
    "slate",
]


class HighlightCreate(BaseModel):
    block_id: str
    lang: Literal["en", "zh"] = "en"
    start_offset: int = Field(ge=0)
    end_offset: int = Field(gt=0)
    selected_text: str = Field(min_length=1)
    color: HighlightColor = "yellow"
    note: Optional[str] = None


class HighlightUpdate(BaseModel):
    color: Optional[HighlightColor] = None
    note: Optional[str] = None


class HighlightOut(BaseModel):
    id: str
    paper_id: str
    block_id: str
    lang: str
    start_offset: int
    end_offset: int
    selected_text: str
    color: str
    note: Optional[str] = None
    created_at: datetime


class ChatMessageOut(BaseModel):
    id: str
    thread_id: str
    role: str
    content: str
    thinking_content: Optional[str] = None
    thinking_level: Optional[str] = None
    created_at: datetime


class QAAnchorOut(BaseModel):
    id: str
    paper_id: str
    block_id: str
    thread_id: str
    lang: str
    start_offset: int
    end_offset: int
    selected_text: str
    created_at: datetime
    messages: list[ChatMessageOut] = []


class PaperDetailOut(BaseModel):
    paper: PaperOut
    outline: list[dict[str, Any]] = []
    references_list: list[dict[str, Any]] = []
    blocks: list[PaperBlockOut] = []
    highlights: list[HighlightOut] = []
    qa_anchors: list[QAAnchorOut] = []
    paper_thread_id: str
    paper_messages: list[ChatMessageOut] = []


class InlineTranslateRequest(BaseModel):
    block_id: str
    selected_text: str
    context_en: Optional[str] = None


class InlineTranslateSaveRequest(BaseModel):
    zh: str


class CreateAnchorQARequest(BaseModel):
    block_id: str
    lang: Literal["en", "zh"] = "en"
    start_offset: int = Field(ge=0)
    end_offset: int = Field(gt=0)
    selected_text: str = Field(min_length=1)
    mode: Literal["explain", "ask"] = "explain"
    question: Optional[str] = None
    thinking_level: Optional[Literal["low", "medium", "high"]] = None


class ThreadMessageCreateRequest(BaseModel):
    question: str = Field(min_length=1)
    thinking_level: Optional[Literal["low", "medium", "high"]] = None
    command_key: Optional[str] = None


class SynthesisRequest(BaseModel):
    paper_ids: list[str] = Field(min_length=2)
    question: Optional[str] = None
    thinking_level: Optional[Literal["low", "medium", "high"]] = None
