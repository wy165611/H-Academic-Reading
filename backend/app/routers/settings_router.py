import time
from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.auth import get_current_user
from app.database import get_db
from app.schemas import SettingTestRequest, SystemSettingOut, SystemSettingUpdate
from app.services.llm_service import (
    LLMServiceError,
    ResolvedModuleConfig,
    call_chat_completion,
    get_or_create_settings,
    mask_api_key,
    resolve_module_config,
)

router = APIRouter(prefix="/api/settings", tags=["settings"])


def _to_out(row) -> SystemSettingOut:
    return SystemSettingOut(
        global_base_url=row.global_base_url,
        global_api_key_masked=mask_api_key(row.global_api_key),
        has_global_api_key=bool((row.global_api_key or "").strip()),
        ocr_model=row.ocr_model,
        ocr_base_url=row.ocr_base_url or "",
        ocr_api_key_masked=mask_api_key(row.ocr_api_key),
        has_ocr_api_key=bool((row.ocr_api_key or "").strip()),
        translate_model=row.translate_model,
        translate_base_url=row.translate_base_url or "",
        translate_api_key_masked=mask_api_key(row.translate_api_key),
        has_translate_api_key=bool((row.translate_api_key or "").strip()),
        chat_model=row.chat_model,
        chat_base_url=row.chat_base_url or "",
        chat_api_key_masked=mask_api_key(row.chat_api_key),
        has_chat_api_key=bool((row.chat_api_key or "").strip()),
        chat_thinking_level=row.chat_thinking_level or "high",
    )


@router.get("", response_model=SystemSettingOut)
def get_settings(
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = get_or_create_settings(db)
    return _to_out(row)


@router.put("", response_model=SystemSettingOut)
def update_settings(
    payload: SystemSettingUpdate,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    row = get_or_create_settings(db)

    if payload.global_base_url is not None and payload.global_base_url.strip():
        row.global_base_url = payload.global_base_url.strip().rstrip("/")
    if payload.global_api_key is not None:
        key_val = payload.global_api_key.strip()
        if key_val and "..." not in key_val:
            row.global_api_key = key_val
        elif key_val == "__CLEAR__":
            row.global_api_key = ""

    if payload.ocr_model is not None and payload.ocr_model.strip():
        row.ocr_model = payload.ocr_model.strip()
    if payload.ocr_base_url is not None:
        row.ocr_base_url = payload.ocr_base_url.strip().rstrip("/") or None
    if payload.ocr_api_key is not None:
        val = payload.ocr_api_key.strip()
        if val == "__CLEAR__":
            row.ocr_api_key = None
        elif val and "..." not in val:
            row.ocr_api_key = val

    if payload.translate_model is not None and payload.translate_model.strip():
        row.translate_model = payload.translate_model.strip()
    if payload.translate_base_url is not None:
        row.translate_base_url = payload.translate_base_url.strip().rstrip("/") or None
    if payload.translate_api_key is not None:
        val = payload.translate_api_key.strip()
        if val == "__CLEAR__":
            row.translate_api_key = None
        elif val and "..." not in val:
            row.translate_api_key = val

    if payload.chat_model is not None and payload.chat_model.strip():
        row.chat_model = payload.chat_model.strip()
    if payload.chat_base_url is not None:
        row.chat_base_url = payload.chat_base_url.strip().rstrip("/") or None
    if payload.chat_api_key is not None:
        val = payload.chat_api_key.strip()
        if val == "__CLEAR__":
            row.chat_api_key = None
        elif val and "..." not in val:
            row.chat_api_key = val
    if payload.chat_thinking_level is not None:
        row.chat_thinking_level = payload.chat_thinking_level

    db.commit()
    db.refresh(row)
    return _to_out(row)


@router.post("/test")
async def test_module_connection(
    payload: SettingTestRequest,
    _user: str = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    saved_cfg = resolve_module_config(db, payload.module)
    raw_key = (payload.api_key or "").strip()
    effective_key = saved_cfg.api_key if (not raw_key or "..." in raw_key) else raw_key
    effective_url = (payload.base_url or "").strip().rstrip("/") or saved_cfg.base_url
    effective_model = (payload.model or "").strip() or saved_cfg.model
    effective_thinking = payload.thinking_level or saved_cfg.thinking_level

    cfg = ResolvedModuleConfig(
        module=payload.module,
        base_url=effective_url,
        api_key=effective_key,
        model=effective_model,
        thinking_level=effective_thinking,
    )

    t0 = time.perf_counter()
    try:
        reply, _reasoning = await call_chat_completion(
            cfg,
            [{"role": "user", "content": "Reply with exactly: OK"}],
            temperature=0.0,
            max_tokens=32,
            thinking_level=effective_thinking if payload.module == "chat" else None,
            timeout_sec=30.0,
            max_retries=1,
        )
        latency_ms = int((time.perf_counter() - t0) * 1000)
        return {
            "ok": True,
            "module": payload.module,
            "model": cfg.model,
            "base_url": cfg.base_url,
            "latency_ms": latency_ms,
            "reply": reply[:120],
        }
    except LLMServiceError as exc:
        latency_ms = int((time.perf_counter() - t0) * 1000)
        return {
            "ok": False,
            "module": payload.module,
            "model": cfg.model,
            "base_url": cfg.base_url,
            "latency_ms": latency_ms,
            "error": str(exc),
        }
