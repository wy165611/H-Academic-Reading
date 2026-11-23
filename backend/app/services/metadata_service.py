import logging
import re
from typing import Any, Optional

import httpx

from app.services.llm_service import (
    ResolvedModuleConfig,
    call_chat_completion,
    clean_and_parse_json,
)

logger = logging.getLogger(__name__)

DOI_REGEX = re.compile(r"\b(10\.\d{4,9}/[-._;()/:A-Za-z0-9]+)\b")
ARXIV_REGEX = re.compile(r"\barXiv:\s*(\d{4}\.\d{4,5}(?:v\d+)?)\b", re.IGNORECASE)

# Built-in curated academic venue tier knowledge base
CURATED_VENUE_TIERS: dict[str, list[str]] = {
    "nature": ["中科院1区", "JCR Q1"],
    "science": ["中科院1区", "JCR Q1"],
    "cell": ["中科院1区", "JCR Q1"],
    "lancet": ["中科院1区", "JCR Q1"],
    "new england journal of medicine": ["中科院1区", "JCR Q1"],
    "nature communications": ["中科院1区", "JCR Q1"],
    "science advances": ["中科院1区", "JCR Q1"],
    "pnas": ["中科院1区", "JCR Q1"],
    "ieee transactions on pattern analysis and machine intelligence": ["中科院1区", "JCR Q1", "CCF-A"],
    "tpami": ["中科院1区", "JCR Q1", "CCF-A"],
    "journal of machine learning research": ["中科院2区", "JCR Q1", "CCF-A"],
    "ieee transactions on image processing": ["中科院1区", "JCR Q1", "CCF-A"],
    "ieee transactions on neural networks and learning systems": ["中科院1区", "JCR Q1", "CCF-B"],
    "ieee transactions on knowledge and data engineering": ["中科院2区", "JCR Q1", "CCF-A"],
    "acm computing surveys": ["中科院1区", "JCR Q1"],
    "cvpr": ["CCF-A"],
    "conference on computer vision and pattern recognition": ["CCF-A"],
    "iccv": ["CCF-A"],
    "international conference on computer vision": ["CCF-A"],
    "eccv": ["CCF-B"],
    "neurips": ["CCF-A"],
    "advances in neural information processing systems": ["CCF-A"],
    "icml": ["CCF-A"],
    "international conference on machine learning": ["CCF-A"],
    "iclr": ["顶会"],
    "international conference on learning representations": ["顶会"],
    "acl": ["CCF-A"],
    "association for computational linguistics": ["CCF-A"],
    "emnlp": ["CCF-B"],
    "aaai": ["CCF-A"],
    "ijcai": ["CCF-A"],
    "kdd": ["CCF-A"],
    "sigir": ["CCF-A"],
    "sigmod": ["CCF-A"],
    "vldb": ["CCF-A"],
    "osdi": ["CCF-A"],
    "sosp": ["CCF-A"],
    "chi": ["CCF-A"],
}


def extract_doi_and_arxiv(text: str) -> tuple[Optional[str], Optional[str]]:
    doi_match = DOI_REGEX.search(text or "")
    doi = doi_match.group(1).rstrip(".,;)") if doi_match else None
    arxiv_match = ARXIV_REGEX.search(text or "")
    arxiv_id = arxiv_match.group(1) if arxiv_match else None
    return doi, arxiv_id


def lookup_curated_tier(venue: Optional[str], arxiv_id: Optional[str]) -> list[str]:
    if venue:
        v_lower = venue.lower().strip()
        for key, tiers in CURATED_VENUE_TIERS.items():
            if key in v_lower:
                return list(tiers)
        if "arxiv" in v_lower:
            return ["arXiv"]
    if arxiv_id:
        return ["arXiv"]
    return []


def _strip_jats_tags(raw: str) -> str:
    return re.sub(r"<[^>]+>", " ", raw or "").replace("  ", " ").strip()


async def query_crossref(doi: Optional[str], title_hint: Optional[str]) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            if doi:
                url = f"https://api.crossref.org/works/{doi}"
                resp = await client.get(url, headers={"User-Agent": "ScholareadSelfHosted/1.0"})
                if resp.status_code == 200:
                    msg = resp.json().get("message", {})
                    return _parse_crossref_item(msg)
            if title_hint and len(title_hint.strip()) > 10:
                resp = await client.get(
                    "https://api.crossref.org/works",
                    params={"query.title": title_hint.strip()[:200], "rows": 1},
                    headers={"User-Agent": "ScholareadSelfHosted/1.0"},
                )
                if resp.status_code == 200:
                    items = resp.json().get("message", {}).get("items", [])
                    if items:
                        return _parse_crossref_item(items[0])
    except Exception as exc:
        logger.info("Crossref lookup skipped/failed: %s", exc)
    return {}


def _parse_crossref_item(item: dict[str, Any]) -> dict[str, Any]:
    titles = item.get("title") or []
    title = titles[0] if titles else ""
    authors = []
    for a in item.get("author") or []:
        given = (a.get("given") or "").strip()
        family = (a.get("family") or "").strip()
        full = f"{given} {family}".strip()
        if full:
            authors.append(full)
    year = None
    for date_key in ("published-print", "published-online", "issued", "created"):
        parts = (item.get(date_key) or {}).get("date-parts") or []
        if parts and parts[0]:
            year = int(parts[0][0])
            break
    containers = item.get("container-title") or []
    venue = containers[0] if containers else ""
    issns = item.get("ISSN") or []
    issn = issns[0] if issns else None
    abstract = _strip_jats_tags(item.get("abstract") or "")
    return {
        "title": title,
        "authors": authors,
        "year": year,
        "venue": venue,
        "issn": issn,
        "doi": item.get("DOI"),
        "abstract_en": abstract,
    }


def _reconstruct_openalex_abstract(inv_idx: Optional[dict[str, list[int]]]) -> str:
    if not inv_idx:
        return ""
    words: dict[int, str] = {}
    for word, positions in inv_idx.items():
        for pos in positions:
            words[pos] = word
    if not words:
        return ""
    return " ".join(words[i] for i in sorted(words.keys()))


async def query_openalex(doi: Optional[str], title_hint: Optional[str]) -> dict[str, Any]:
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            work = None
            if doi:
                resp = await client.get(f"https://api.openalex.org/works/https://doi.org/{doi}")
                if resp.status_code == 200:
                    work = resp.json()
            elif title_hint and len(title_hint.strip()) > 10:
                resp = await client.get(
                    "https://api.openalex.org/works",
                    params={"search": title_hint.strip()[:200], "per-page": 1},
                )
                if resp.status_code == 200:
                    results = resp.json().get("results") or []
                    if results:
                        work = results[0]
            if not work:
                return {}
            authors = [
                (a.get("author") or {}).get("display_name", "").strip()
                for a in work.get("authorships") or []
                if (a.get("author") or {}).get("display_name")
            ]
            source = (work.get("primary_location") or {}).get("source") or {}
            venue = source.get("display_name") or ""
            issn_l = source.get("issn_l")
            return {
                "title": work.get("title") or "",
                "authors": authors,
                "year": work.get("publication_year"),
                "venue": venue,
                "issn": issn_l,
                "doi": (work.get("doi") or "").replace("https://doi.org/", "") or None,
                "abstract_en": _reconstruct_openalex_abstract(work.get("abstract_inverted_index")),
            }
    except Exception as exc:
        logger.info("OpenAlex lookup skipped/failed: %s", exc)
    return {}


def guess_title_from_first_page(first_page_text: str) -> str:
    lines = [ln.strip() for ln in (first_page_text or "").splitlines() if ln.strip()]
    filtered = [
        ln
        for ln in lines[:12]
        if len(ln) > 12
        and not ln.lower().startswith(("arxiv:", "published", "proceedings", "copyright", "http"))
    ]
    return filtered[0] if filtered else (lines[0] if lines else "Untitled Paper")


async def extract_rich_metadata(
    first_two_pages_text: str,
    fallback_title: str,
    translate_cfg: ResolvedModuleConfig,
) -> dict[str, Any]:
    """
    Step 2 of Module 2 pipeline:
    1) Regex extract DOI / arXiv ID from first 2 pages.
    2) Query Crossref & OpenAlex public APIs.
    3) Use configured metadata/translate LLM (default deepseek-v4.1-flash-1017) to output strict JSON
       with title, title_zh, authors, venue, year, doi, abstract_en, abstract_zh, journal_tier.
    """
    doi, arxiv_id = extract_doi_and_arxiv(first_two_pages_text)
    title_hint = guess_title_from_first_page(first_two_pages_text)

    crossref_data = await query_crossref(doi, title_hint)
    openalex_data = await query_openalex(doi or crossref_data.get("doi"), title_hint)

    merged_api: dict[str, Any] = {
        "title": crossref_data.get("title") or openalex_data.get("title") or title_hint or fallback_title,
        "authors": crossref_data.get("authors") or openalex_data.get("authors") or [],
        "year": crossref_data.get("year") or openalex_data.get("year"),
        "venue": crossref_data.get("venue") or openalex_data.get("venue") or ("arXiv" if arxiv_id else ""),
        "issn": crossref_data.get("issn") or openalex_data.get("issn"),
        "doi": doi or crossref_data.get("doi") or openalex_data.get("doi"),
        "arxiv_id": arxiv_id,
        "abstract_en": crossref_data.get("abstract_en") or openalex_data.get("abstract_en") or "",
    }

    if translate_cfg.api_key:
        prompt = (
            "你是一个专业的学术文献元数据与期刊分区识别专家。请结合以下论文前两页原文与 Crossref/OpenAlex 检索结果，"
            "提取并输出严格合法的 JSON 对象（不要输出任何解释或额外文本）：\n"
            "字段要求：\n"
            '{\n'
            '  "title": "标准英文原标题",\n'
            '  "title_zh": "准确且凝练的学术中文译题",\n'
            '  "authors": ["第一作者全名", "第二作者全名"],\n'
            '  "venue": "期刊或顶级会议标准全称/简称（若是预印本填 arXiv）",\n'
            '  "year": 2024,\n'
            '  "doi": "10.xxxx/xxxx 或 null",\n'
            '  "abstract_en": "英文完整摘要（若为空则从前两页摘要段落抽取）",\n'
            '  "abstract_zh": "流畅准确的学术中文摘要",\n'
            '  "journal_tier": ["期刊分区/会议等级标签数组，例如 中科院1区, JCR Q1, CCF-A 或 arXiv；未知则输出空数组 []"]\n'
            '}\n\n'
            f"【Crossref/OpenAlex 辅助信息】:\n{merged_api}\n\n"
            f"【PDF 前两页文本】:\n{first_two_pages_text[:4500]}"
        )
        content, _ = await call_chat_completion(
            translate_cfg,
            [
                {"role": "system", "content": "You output strictly valid JSON only."},
                {"role": "user", "content": prompt},
            ],
            temperature=0.1,
            max_tokens=2048,
        )
        parsed = clean_and_parse_json(content)
        if isinstance(parsed, dict):
            curated = lookup_curated_tier(parsed.get("venue") or merged_api["venue"], arxiv_id)
            llm_tiers = parsed.get("journal_tier") or []
            if not isinstance(llm_tiers, list):
                llm_tiers = [str(llm_tiers)] if llm_tiers else []
            combined_tiers = list(dict.fromkeys([*curated, *[str(t).strip() for t in llm_tiers if str(t).strip()]]))
            return {
                "title": (parsed.get("title") or merged_api["title"] or fallback_title).strip(),
                "title_zh": (parsed.get("title_zh") or "").strip() or None,
                "authors": parsed.get("authors") if isinstance(parsed.get("authors"), list) else merged_api["authors"],
                "venue": (parsed.get("venue") or merged_api["venue"] or "").strip() or None,
                "year": int(parsed["year"]) if parsed.get("year") and str(parsed["year"]).isdigit() else merged_api["year"],
                "issn": merged_api["issn"],
                "doi": parsed.get("doi") or merged_api["doi"],
                "arxiv_id": arxiv_id,
                "abstract_en": (parsed.get("abstract_en") or merged_api["abstract_en"] or "").strip() or None,
                "abstract_zh": (parsed.get("abstract_zh") or "").strip() or None,
                "journal_tier": combined_tiers,
            }

    # Local fallback when API Key is not configured yet
    tiers = lookup_curated_tier(merged_api["venue"], arxiv_id)
    return {
        "title": merged_api["title"] or fallback_title,
        "title_zh": None,
        "authors": merged_api["authors"],
        "venue": merged_api["venue"] or None,
        "year": merged_api["year"],
        "issn": merged_api["issn"],
        "doi": merged_api["doi"],
        "arxiv_id": arxiv_id,
        "abstract_en": merged_api["abstract_en"] or None,
        "abstract_zh": None,
        "journal_tier": tiers,
    }
