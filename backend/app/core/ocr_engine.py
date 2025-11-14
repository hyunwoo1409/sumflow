# backend/app/core/ocr_engine.py
from __future__ import annotations

import os
import io
import time
import re
import fitz
import pytesseract
from PIL import Image, ImageOps, ImageFilter

# .env 기반 설정
from config import (
    OCR_TEXTLAYER_FIRST,
    OCR_LANG,
    OCR_LANG_SECONDARY,
    OCR_PSM_DEFAULT,
    OCR_USER_DPI,
    OCR_UPSCALE,
    OCR_DESKEW,
    TESSDATA_PREFIX,
)

HANGUL_RE = re.compile(r"[가-힣]")


def _deskew_like(g: Image.Image) -> Image.Image:
    """PIL만으로는 강력한 deskew가 어렵기 때문에, 일단 no-op."""
    return g


def _preprocess(img: Image.Image) -> Image.Image:
    """
    흑백 -> 자동대비 -> 이진화 -> 미디안 -> (선택) 간이 디스큐 -> (선택) 업스케일
    """
    g = ImageOps.grayscale(img)
    g = ImageOps.autocontrast(g)
    g = g.point(lambda x: 255 if x > 180 else 0)
    g = g.filter(ImageFilter.MedianFilter(size=3))

    if OCR_DESKEW:
        g = _deskew_like(g)

    if OCR_UPSCALE and OCR_UPSCALE > 1.0:
        w, h = g.size
        g = g.resize((max(1, int(w * OCR_UPSCALE)), max(1, int(h * OCR_UPSCALE))))

    return g


def _stats(text: str):
    n = len(text or "")
    h = len(HANGUL_RE.findall(text or ""))
    return {
        "chars": n,
        "hangul_ratio": round((h / n), 3) if n else 0.0,
    }


def _avg_conf(pil_img: Image.Image, lang: str, psm: int) -> float | None:
    """pytesseract image_to_data 기반 평균 confidence 계산."""
    try:
        data = pytesseract.image_to_data(
            pil_img,
            lang=lang,
            config=f"--oem 1 --psm {psm}",
            output_type=pytesseract.Output.DICT,
        )
        confs = []
        for c in data.get("conf", []):
            try:
                v = float(c)
                if v >= 0:
                    confs.append(v)
            except Exception:
                pass
        if not confs:
            return None
        return round(sum(confs) / len(confs), 2)
    except Exception:
        return None


def _has_sufficient_text_layer(page: fitz.Page, min_chars: int = 40) -> tuple[bool, str]:
    """텍스트 레이어가 일정 길이 이상이면 (True, text) 반환."""
    try:
        t = (page.get_text("text") or "").strip()
        if len(t) >= min_chars:
            return True, t
        return False, ""
    except Exception:
        return False, ""


def _pixmap_to_pil(pix: fitz.Pixmap) -> Image.Image:
    """
    Pixmap → PIL Image 변환 (알파 채널 안전 처리).
    - 알파가 있으면 RGB로 변환한 PNG 바이트를 통해 로딩.
    """
    if pix.alpha:
        # RGBA → PNG 바이트로 안전 변환 후 로딩
        with io.BytesIO(pix.tobytes("png")) as bio:
            return Image.open(bio).convert("RGB")
    # 알파가 없으면 빠른 경로
    return Image.frombytes("RGB", [pix.width, pix.height], pix.samples)


def extract_text_from_pdf(file_path: str, lang: str | None = None):
    """
    PDF → (텍스트 레이어 우선) → 이미지 렌더링 → OCR
    Returns: (text, meta)
      meta: {
        "perf": [{"name": "...","ms": int}],
        "pages": int,
        "ocr_stats": {"chars": int, "hangul_ratio": float, "avg_conf": Optional[float]}
      }
    """
    t0 = time.perf_counter()
    text_chunks: list[str] = []
    confs: list[float] = []
    perf: list[dict] = []
    pages = 0

    use_lang_primary = lang or OCR_LANG
    use_lang_retry = OCR_LANG_SECONDARY
    psm_primary = OCR_PSM_DEFAULT
    psm_retry = 11 if psm_primary == 6 else 6

    dpi_primary = int(OCR_USER_DPI or 300)
    dpi_primary = max(72, dpi_primary)  # 최소 DPI 보장
    dpi_retry = max(240, dpi_primary)

    # Tesseract 환경
    if TESSDATA_PREFIX:
        os.environ["TESSDATA_PREFIX"] = TESSDATA_PREFIX

    # 0) 텍스트 레이어 우선 추출
    try:
        with fitz.open(file_path) as doc:
            pages = len(doc)
            if OCR_TEXTLAYER_FIRST:
                t_start = time.perf_counter()
                for p in doc:
                    ok, tl = _has_sufficient_text_layer(p)
                    if ok:
                        text_chunks.append(tl)
                perf.append(
                    {"name": "textlayer_extract", "ms": int((time.perf_counter() - t_start) * 1000)}
                )
                if any(t.strip() for t in text_chunks):
                    # 텍스트 레이어만으로 충분
                    text = "\n\n".join(text_chunks).strip()
                    meta = {
                        "perf": perf + [{"name": "ocr", "ms": int((time.perf_counter() - t0) * 1000)}],
                        "pages": pages,
                        "ocr_stats": {**_stats(text), "avg_conf": None},
                    }
                    return text, meta
    except Exception:
        # 텍스트 레이어 단계 오류는 무시하고 OCR로 진행
        pass

    # 1) 1차 OCR
    try:
        with fitz.open(file_path) as doc:
            t_render0 = time.perf_counter()
            pages = len(doc) or pages
            for p in doc:
                try:
                    pix = p.get_pixmap(dpi=dpi_primary)
                    img = _pixmap_to_pil(pix)
                    g = _preprocess(img)
                    text = pytesseract.image_to_string(
                        g, lang=use_lang_primary, config=f"--oem 1 --psm {psm_primary}"
                    )
                    if text and text.strip():
                        text_chunks.append(text)
                    c = _avg_conf(g, use_lang_primary, psm_primary)
                    if c is not None:
                        confs.append(c)
                except Exception:
                    # 개별 페이지 실패는 건너뛰고 계속
                    continue
            perf.append({
                "name": f"render+ocr:psm{psm_primary}:{use_lang_primary}",
                "ms": int((time.perf_counter() - t_render0) * 1000)
            })
    except Exception:
        # 문서를 열 수 없거나 전체 실패 시 빈 상태로 진행
        pass

    # 2) 폴백: 결과가 빈/매우 짧은 경우에만
    if not any((t or "").strip() for t in text_chunks):
        try:
            with fitz.open(file_path) as doc:
                t_render1 = time.perf_counter()
                pages = len(doc) or pages
                for p in doc:
                    try:
                        pix = p.get_pixmap(dpi=dpi_retry)
                        img = _pixmap_to_pil(pix)
                        g = _preprocess(img)
                        text = pytesseract.image_to_string(
                            g, lang=use_lang_retry, config=f"--oem 1 --psm {psm_retry}"
                        )
                        if text and text.strip():
                            text_chunks.append(text)
                        c = _avg_conf(g, use_lang_retry, psm_retry)
                        if c is not None:
                            confs.append(c)
                    except Exception:
                        continue
                perf.append({
                    "name": f"retry:psm{psm_retry}:{use_lang_retry}",
                    "ms": int((time.perf_counter() - t_render1) * 1000)
                })
        except Exception:
            pass

    # 3) 메타 조립
    text = "\n\n".join([t for t in text_chunks if t and t.strip()]).strip()
    meta = {
        "perf": perf + [{"name": "ocr", "ms": int((time.perf_counter() - t0) * 1000)}],
        "pages": pages,
        "ocr_stats": {
            **_stats(text),
            "avg_conf": (round(sum(confs) / len(confs), 2) if confs else None),
        },
    }
    return text, meta
