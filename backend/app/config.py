# backend/app/config.py
from __future__ import annotations

import os
from pathlib import Path

# ---------- helpers ----------
def _to_bool(v: str, default: bool) -> bool:
    if v is None:
        return default
    return str(v).strip().lower() in ("1", "true", "yes", "y", "on")

def _to_int(v: str, default: int) -> int:
    try:
        return int(str(v).strip())
    except Exception:
        return default

def _to_float(v: str, default: float) -> float:
    try:
        return float(str(v).strip())
    except Exception:
        return default

# ---------- OCR / Tesseract ----------
OCR_TEXTLAYER_FIRST = _to_bool(os.getenv("OCR_TEXTLAYER_FIRST", "true"), True)
OCR_LANG = os.getenv("OCR_LANG", "kor")
OCR_LANG_SECONDARY = os.getenv("OCR_LANG_SECONDARY", "kor+eng")
OCR_PSM_DEFAULT = _to_int(os.getenv("OCR_PSM_DEFAULT", "6"), 6)
OCR_USER_DPI = _to_int(os.getenv("OCR_USER_DPI", "300"), 300)
OCR_UPSCALE = _to_float(os.getenv("OCR_UPSCALE", "2.0"), 2.0)   # PIL 업스케일은 보수적으로
OCR_DESKEW = _to_bool(os.getenv("OCR_DESKEW", "true"), True)    # PIL 디스큐는 약하게
TESSDATA_PREFIX = os.getenv("TESSDATA_PREFIX", "").strip()

# ---------- absolute paths ----------
BASE_DIR = Path(__file__).resolve().parents[2]  # backend/ 기준

def _abs(p: str) -> str:
    """상대경로면 backend 기준 절대경로로 변환"""
    pp = Path(p)
    return str((BASE_DIR / pp).resolve()) if not pp.is_absolute() else str(pp.resolve())

UPLOAD_DIR = _abs(os.getenv("UPLOAD_DIR", "./uploads"))
RESULT_DIR = _abs(os.getenv("RESULT_DIR", "./results"))

def ensure_data_dirs() -> None:
    """앱 시작 시 한 번 호출해서 디렉토리 존재 보장"""
    Path(UPLOAD_DIR).mkdir(parents=True, exist_ok=True)
    Path(RESULT_DIR).mkdir(parents=True, exist_ok=True)


# --- Upload & ZIP limits ---
ALLOWED_SINGLE_EXTS = {'.pdf', '.docx', '.hwp', '.pptx', '.xlsx'}
ZIP_MAX_FILES = int(os.getenv('ZIP_MAX_FILES', '200'))
ZIP_MAX_BYTES = int(os.getenv('ZIP_MAX_BYTES', str(200 * 1024 * 1024)))
LOFFICE_BIN = os.getenv('LOFFICE_BIN')
HWP5TXT_BIN = os.getenv('HWP5TXT_BIN')
