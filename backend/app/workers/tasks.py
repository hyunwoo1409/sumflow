from __future__ import annotations
import shutil, re, hashlib, json, logging, os, sys, time, unicodedata
from pathlib import Path

_THIS = os.path.abspath(__file__)
_APP_DIR = os.path.dirname(os.path.dirname(_THIS))   # .../backend/app
if _APP_DIR not in sys.path:
    sys.path.insert(0, _APP_DIR)

from .celery_app import celery
from core.ocr_engine import extract_text_from_pdf
from core.llm_engine import summarize_with_ollama
from core.category_parser import (
    extract_llm_category,
    parse_category_by_keywords,
    normalize_to_two_levels,
)
from core.perf_recorder import perf_scope
from utils.rcache import set_ocr_text
from config import RESULT_DIR
from converters import document_ingest

logger = logging.getLogger(__name__)

# ───────────────────────────────────────────────
def sanitize_stem(s: str, limit: int = 64) -> str:
    s = re.sub(r"[^\w\-\.]+", "_", s)
    s = re.sub(r"_+", "_", s).strip("._")
    return (s or "file")[:limit]

def make_changed_filename(original_name: str, salt: str = "") -> str:
    stem, ext = os.path.splitext(original_name)
    base = sanitize_stem(stem)
    h = hashlib.sha1((original_name + salt).encode("utf-8")).hexdigest()[:8]
    return f"{base}_{h}{ext or ''}"

STAGE_PCT = {
    "QUEUED": 0, "INGEST_START": 10, "INGEST_DONE": 40,
    "OCR_START": 10, "OCR_DONE": 50,
    "LLM_START": 70, "LLM_DONE": 90,
    "CATEGORY_START": 92, "DONE": 100,
}

@celery.task(
    bind=True,
    name="app.workers.tasks.process_pdf",
    autoretry_for=(Exception,),
    retry_backoff=5,
    retry_jitter=True,
    max_retries=3,
)
def process_pdf(self, *, file_path: str, filename: str, batch_id: str, sha: str):
    """파일 인식/요약/카테고리화 Celery Task"""
    start = time.time()
    TOTAL = 100
    _hist = {"t": start, "p": 0.0, "ema": 0.0}

    def _emit(stage_key: str, stage_label: str):
        now = time.time()
        p = float(max(0, min(STAGE_PCT.get(stage_key, 0), TOTAL)))
        dt = max(1e-6, now - _hist["t"])
        dp = max(0.0, p - _hist["p"])
        inst = dp / dt
        ema = inst if _hist["ema"] == 0.0 else (0.5 * inst + 0.5 * _hist["ema"])
        eta_seconds = int(max(0.0, (TOTAL - p) / max(ema, 1e-6))) if p < TOTAL else 0
        finish_at = int(now + eta_seconds) if p < TOTAL else int(now)
        _hist.update({"t": now, "p": p, "ema": ema})
        meta = {
            "stage": stage_label, "current": int(p), "total": TOTAL,
            "percent": int(round(p)), "start_time": int(start),
            "eta_seconds": eta_seconds, "finish_at": finish_at,
            "filename": filename,
        }
        self.update_state(state="PROGRESS", meta=meta)

    task_id = self.request.id
    ttl = int(os.getenv("OCR_CACHE_TTL", "3600"))
    _emit("QUEUED", "QUEUED")

    # ========= 파일명 정규화(ASCII) + 단일 저장(이동) =========
    def _to_ascii_name(name: str) -> str:
        # 비ASCII 제거 후 안전문자만, 길이 제한
        norm = unicodedata.normalize("NFKD", name)
        ascii_only = norm.encode("ascii", "ignore").decode("ascii")
        ascii_only = re.sub(r"[^\w.\-]+", "_", ascii_only).strip("._")
        return ascii_only[:120] or "file"

    def _sanitize_stem(stem: str) -> str:
        s = re.sub(r"[^\w.\-]+", "_", stem)
        s = re.sub(r"_+", "_", s).strip("._")
        return s[:64] or "file"

    original_filename = filename  # 사용자가 올린 원래 이름(표시용)
    ascii_name = _to_ascii_name(original_filename)
    stem, ext = os.path.splitext(ascii_name)
    stem = _sanitize_stem(stem)
    short = hashlib.sha1((original_filename + (sha or "") + batch_id).encode("utf-8")).hexdigest()[:8]
    changed_filename = f"{stem}_{short}{(ext or '').lower()}"

    UPLOADS_ROOT = Path(os.getenv("FILE_UPLOADS_DIR",
                     Path(RESULT_DIR).resolve().parent / "uploads")).resolve()
    upload_dir = (UPLOADS_ROOT / batch_id).resolve()
    upload_dir.mkdir(parents=True, exist_ok=True)

    # 원본→정책명으로 '이동'(복사 금지). 이미 있으면 덮어쓰기.
    src = Path(file_path).resolve()
    if not src.exists():
        raise FileNotFoundError(f"not found: {src}")
    dst = (upload_dir / changed_filename).resolve()
    if src != dst:
        dst.parent.mkdir(parents=True, exist_ok=True)
        try:
            if dst.exists():
                dst.unlink()
        except Exception:
            pass
        shutil.move(str(src), str(dst))
    stored_path = dst

    # 혹시 업로드 폴더에 원본명이 남아있으면 제거(메타파일 제외)
    try:
        orphan = upload_dir / original_filename
        if orphan.exists() and orphan.is_file() and orphan != stored_path:
            orphan.unlink()
    except Exception:
        pass

    # ===== OCR / INGESET / LLM / CATEGORY =====
    with perf_scope() as perf:
        text = ""
        ocr_meta = {"perf": []}

        ext = stored_path.suffix.lower()
        if ext in {".doc", ".docx", ".hwp", ".hwpx", ".odt", ".rtf", ".txt"}:
            _emit("INGEST_START", "INGEST")
            try:
                ingest = document_ingest.extract_text(str(stored_path))
                if ingest.get("ok") and ingest.get("text"):
                    text = ingest["text"]
                    ocr_meta = {
                        "engine": "ingest",
                        "perf": ingest.get("perf", []),
                        "pages": ingest.get("pages"),
                        "ocr_stats": ingest.get("stats", {}),
                    }
                else:
                    raise ValueError("Ingest returned no text")
                _emit("INGEST_DONE", "INGEST")
            except Exception:
                _emit("OCR_START", "OCR")
                text, ocr_meta = extract_text_from_pdf(str(stored_path))
                _emit("OCR_DONE", "OCR")
        else:
            _emit("OCR_START", "OCR")
            text, ocr_meta = extract_text_from_pdf(str(stored_path))
            _emit("OCR_DONE", "OCR")

        try:
            set_ocr_text(task_id=task_id, text=text or "", ttl=ttl)
        except Exception as e:
            logger.warning("set_ocr_text failed for %s: %s", task_id, e)

        _emit("LLM_START", "LLM")
        summary, llm_ok, llm_meta = summarize_with_ollama(text or "")
        _emit("LLM_DONE", "LLM")

        _emit("CATEGORY_START", "CATEGORY")
        llm_data = (llm_meta or {}).get("llm_data") or {}
        cat_from_meta = llm_data.get("category_name")
        llm_raw = (llm_meta or {}).get("llm_raw") or ""
        try:
            cat_from_raw = extract_llm_category(llm_raw)
        except Exception as e:
            logger.exception("extract_llm_category failed: %s", e)
            cat_from_raw = None

        if cat_from_meta:
            raw_category = cat_from_meta
        elif cat_from_raw:
            raw_category = cat_from_raw
        else:
            raw_category = parse_category_by_keywords(text or "")

        try:
            category = normalize_to_two_levels(raw_category)
        except Exception:
            category = "기타/일반"

        category_source = (
            "llm_meta" if cat_from_meta else "llm_raw" if cat_from_raw else "backup_keywords"
        )
        display_summary_two_lines = f"요약 : {(summary or '').strip()}\n\n카테고리 : {category}"
        _emit("DONE", "DONE")

    # ===== 결과 저장 =====
    batch_dir = Path(RESULT_DIR).resolve() / batch_id
    batch_dir.mkdir(parents=True, exist_ok=True)

    result = {
        "task_id": task_id,
        "batch_id": batch_id,
        "original_filename": original_filename,   # 표시용(한글 가능)
        "changed_filename": changed_filename,     # 저장된 정책명(ASCII)
        "file_path": str(stored_path),            # 절대경로
        "sha": sha,
        "summary": summary,
        "summary_two_lines": display_summary_two_lines,
        "category": category,
        "category_name": category,
        "category_source": category_source,
        "llm_ok": llm_ok,
        "perf": (ocr_meta.get("perf", []) + (llm_meta or {}).get("perf", []) + perf.dump()),
        "pages": ocr_meta.get("pages"),
        "ocr_stats": ocr_meta.get("ocr_stats") or {},
        "llm_meta": llm_meta,
        "committed": False,
    }

    (batch_dir / f"{task_id}.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    task_dir = batch_dir / task_id
    (task_dir / "llm").mkdir(parents=True, exist_ok=True)
    (task_dir / "llm" / "summary.txt").write_text(summary or "", encoding="utf-8")
    (task_dir / "meta.json").write_text(
        json.dumps(result, ensure_ascii=False, indent=2), encoding="utf-8"
    )

    return result