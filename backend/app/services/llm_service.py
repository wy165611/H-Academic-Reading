import asyncio
import json
import logging
import re
from dataclasses import dataclass
from typing import Any, Optional

import httpx
from sqlalchemy.orm import Session

from app.config import settings
from app.models import SystemSetting

logger = logging.getLogger(__name__)


@dataclass
class ResolvedModuleConfig:
    module: str
    base_url: str
    api_key: str
    model: str
    thinking_level: str = "high"


def get_or_create_settings(db: Session) -> SystemSetting:
    row = db.query(SystemSetting).filter(SystemSetting.id == 1).first()
    if row is None:
        row = SystemSetting(
            id=1,
            global_base_url=settings.DEFAULT_LLM_BASE_URL,
            global_api_key=settings.DEFAULT_LLM_API_KEY,
            ocr_model=settings.DEFAULT_VISION_MODEL,
            translate_model=settings.DEFAULT_TRANSLATE_MODEL,
            chat_model=settings.DEFAULT_CHAT_MODEL,
            chat_thinking_level=settings.DEFAULT_CHAT_THINKING_LEVEL,
        )
        db.add(row)
        db.commit()
        db.refresh(row)
    return row


def resolve_module_config(db: Session, module: str) -> ResolvedModuleConfig:
    row = get_or_create_settings(db)
    base_url = row.global_base_url
    api_key = row.global_api_key
    model = row.chat_model
    thinking_level = row.chat_thinking_level or "high"

    if module == "ocr":
        base_url = (row.ocr_base_url or "").strip() or row.global_base_url
        api_key = (row.ocr_api_key or "").strip() or row.global_api_key
        model = (row.ocr_model or "").strip() or settings.DEFAULT_VISION_MODEL
    elif module == "translate":
        base_url = (row.translate_base_url or "").strip() or row.global_base_url
        api_key = (row.translate_api_key or "").strip() or row.global_api_key
        model = (row.translate_model or "").strip() or settings.DEFAULT_TRANSLATE_MODEL
    elif module == "chat":
        base_url = (row.chat_base_url or "").strip() or row.global_base_url
        api_key = (row.chat_api_key or "").strip() or row.global_api_key
        model = (row.chat_model or "").strip() or settings.DEFAULT_CHAT_MODEL

    return ResolvedModuleConfig(
        module=module,
        base_url=base_url.rstrip("/"),
        api_key=api_key.strip(),
        model=model.strip(),
        thinking_level=thinking_level,
    )


def mask_api_key(key: Optional[str]) -> str:
    if not key:
        return ""
    k = key.strip()
    if len(k) <= 8:
        return "*" * len(k)
    return f"{k[:4]}...{k[-4:]}"


def _escape_invalid_json_backslashes(text: str) -> str:
    # Fix unescaped LaTeX backslashes like \frac, \alpha, \mathbb inside JSON strings
    return re.sub(r'\\(?!["\\/bfnrtu])', r"\\\\", text)


def clean_and_parse_json(raw_text: str) -> Any:
    if not raw_text:
        raise ValueError("Empty model response")

    cleaned = re.sub(r"<think>[\s\S]*?</think>", "", raw_text, flags=re.IGNORECASE).strip()

    # Extract fenced code block if present
    fence_match = re.search(r"```(?:json)?\s*([\s\S]*?)```", cleaned, flags=re.IGNORECASE)
    if fence_match:
        cleaned = fence_match.group(1).strip()

    # Locate first JSON object or array
    start_obj = cleaned.find("{")
    start_arr = cleaned.find("[")
    candidates = [idx for idx in (start_obj, start_arr) if idx != -1]
    if not candidates:
        raise ValueError("No JSON object or array found in model response")
    start_idx = min(candidates)
    open_char = cleaned[start_idx]
    close_char = "}" if open_char == "{" else "]"
    end_idx = cleaned.rfind(close_char)
    if end_idx > start_idx:
        cleaned = cleaned[start_idx : end_idx + 1]

    try:
        return json.loads(cleaned)
    except json.JSONDecodeError:
        fixed = _escape_invalid_json_backslashes(cleaned)
        return json.loads(fixed)


class LLMServiceError(RuntimeError):
    pass


async def call_chat_completion(
    cfg: ResolvedModuleConfig,
    messages: list[dict[str, Any]],
    *,
    temperature: float = 0.2,
    max_tokens: int = 4096,
    thinking_level: Optional[str] = None,
    timeout_sec: float = 120.0,
    max_retries: int = 3,
) -> tuple[str, Optional[str]]:
    """
    Call an OpenAI-compatible /chat/completions endpoint with exponential backoff retries.
    Returns (content_text, reasoning_content_if_any).
    """
    if not cfg.api_key:
        raise LLMServiceError(f"未配置模块 [{cfg.module}] 的 API Key，请前往「设置」填入百炼 API Key。")
    if not cfg.base_url:
        raise LLMServiceError(f"未配置模块 [{cfg.module}] 的 Base URL。")

    endpoint = f"{cfg.base_url}/chat/completions"
    headers = {
        "Authorization": f"Bearer {cfg.api_key}",
        "Content-Type": "application/json",
    }

    effective_thinking = thinking_level or cfg.thinking_level
    use_reasoning_param = cfg.module == "chat" and effective_thinking in ("low", "medium", "high")

    last_error: Optional[Exception] = None
    backoff_delays = [1.5, 3.0, 6.0]

    for attempt in range(max_retries + 1):
        payload: dict[str, Any] = {
            "model": cfg.model,
            "messages": messages,
            "temperature": temperature,
            "max_tokens": max_tokens,
        }
        if use_reasoning_param:
            payload["reasoning_effort"] = effective_thinking

        try:
            async with httpx.AsyncClient(timeout=httpx.Timeout(timeout_sec, connect=20.0)) as client:
                resp = await client.post(endpoint, headers=headers, json=payload)

            if resp.status_code == 400 and use_reasoning_param:
                # Some compatible providers/models reject reasoning_effort; drop it and retry cleanly
                use_reasoning_param = False
                continue

            if resp.status_code in (429, 500, 502, 503, 504):
                err_msg = f"HTTP {resp.status_code}: {resp.text[:300]}"
                last_error = LLMServiceError(err_msg)
                if attempt < max_retries:
                    delay = backoff_delays[min(attempt, len(backoff_delays) - 1)]
                    logger.warning("LLM transient error (%s), retrying in %.1fs...", err_msg, delay)
                    await asyncio.sleep(delay)
                    continue
                raise last_error

            if resp.status_code >= 400:
                raise LLMServiceError(f"API 请求失败 (HTTP {resp.status_code}): {resp.text[:400]}")

            data = resp.json()
            choices = data.get("choices") or []
            if not choices:
                raise LLMServiceError("API 返回中缺少 choices 字段")

            message = choices[0].get("message") or {}
            content = message.get("content")
            if isinstance(content, list):
                content = "\n".join(
                    part.get("text", "") for part in content if isinstance(part, dict)
                )
            content_str = (content or "").strip()
            reasoning_str = message.get("reasoning_content")
            if isinstance(reasoning_str, str):
                reasoning_str = reasoning_str.strip() or None
            else:
                reasoning_str = None

            if not content_str and reasoning_str:
                content_str = reasoning_str

            return content_str, reasoning_str

        except (httpx.TimeoutException, httpx.NetworkError, httpx.TransportError) as exc:
            last_error = exc
            if attempt < max_retries:
                delay = backoff_delays[min(attempt, len(backoff_delays) - 1)]
                logger.warning("LLM network/timeout error (%s), retrying in %.1fs...", exc, delay)
                await asyncio.sleep(delay)
                continue
            raise LLMServiceError(f"请求模型超时或网络中断: {exc}") from exc

    raise LLMServiceError(f"模型调用失败: {last_error}")
