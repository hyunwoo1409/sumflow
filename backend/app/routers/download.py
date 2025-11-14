from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, PlainTextResponse
from pathlib import Path
from sqlalchemy import text
import os, mimetypes
from typing import Optional, Tuple

try:
    from core.db import engine
except Exception:
    from app.core.db import engine

router = APIRouter(prefix="/download", tags=["Download"])

# ===== 경로 기본값 =====
# .../sumflow-main/sumflow-main/backend/app/routers/download.py 기준으로 3단계 위
REPO_DIR = Path(__file__).resolve().parents[3]

ENV_UPLOADS = os.getenv("FILE_UPLOADS_DIR", "").strip()
ENV_OCR = os.getenv("OCR_STORE_DIR", "").strip()

def _first_existing(paths):
    for p in paths:
        if p and Path(p).exists():
            return Path(p).resolve()
    return None

UPLOADS_DIR: Optional[Path] = _first_existing([
    Path(ENV_UPLOADS) if ENV_UPLOADS else None,
    (REPO_DIR / "uploads"),
])
OCR_DIR: Optional[Path] = _first_existing([
    Path(ENV_OCR) if ENV_OCR else None,
    (REPO_DIR / "ocr_store" / "uploads"),
])

def _safe_in(base: Path, p: Path) -> bool:
    """p가 base 하위인지 확인 (경로 탈출 방지)"""
    try:
        p.resolve().relative_to(base.resolve())
        return True
    except Exception:
        return False

# ── DB 조회 ─────────────────────────────
def _fetch_doc_row(id_or_key: str) -> Optional[dict]:
    """
    id_or_key가 숫자면 DOCUMENT_ID로, 아니면 BATCH_ID / RESULT_FOLDER_ID로 매칭
    """
    sql = text("""
        SELECT DOCUMENT_ID, BATCH_ID, RESULT_FOLDER_ID,
               ORIGINAL_FILENAME, CHANGED_FILENAME
        FROM DOCUMENT
        WHERE
            (CASE WHEN :did REGEXP '^[0-9]+$' THEN DOCUMENT_ID = CAST(:did AS SIGNED) ELSE 0 END)
            OR BATCH_ID = :idk
            OR RESULT_FOLDER_ID = :idk
        LIMIT 1
    """)
    with engine.begin() as conn:
        row = conn.execute(sql, {"did": id_or_key, "idk": id_or_key}).mappings().first()
    return dict(row) if row else None

# ── 원본 찾기 ─────────────────────────────
def _pick_largest_file(folder: Path) -> Optional[Path]:
    files = [f for f in folder.rglob("*") if f.is_file()]
    if not files:
        return None
    files.sort(key=lambda x: x.stat().st_size, reverse=True)
    return files[0].resolve()

def find_original(id_or_key: str) -> Tuple[Optional[Path], Optional[str]]:
    """
    원본 파일 경로와 표시 파일명을 찾는다.
    1) DB에서 BATCH_ID/파일명 조합으로 직접 찾기
    2) 배치 폴더 안에서 가장 큰 파일로 폴백
    3) (옵션) 업로드 루트에서 폴더명/상대경로로 직접 접근 가능할 때 찾기
    """
    if not UPLOADS_DIR:
        return None, None

    p: Optional[Path] = None
    display_name: Optional[str] = None

    row = _fetch_doc_row(id_or_key)
    # ── DB 매칭이 없으면 업로드 루트에서 직접 탐색 시도 (폴더/파일 키)
    if not row:
        # 업로드 루트/<id_or_key> 가 디렉터리면 그 안 최대 파일
        cand_dir = (UPLOADS_DIR / str(id_or_key)).resolve()
        if cand_dir.is_dir() and _safe_in(UPLOADS_DIR, cand_dir):
            p = _pick_largest_file(cand_dir)
            if p:
                display_name = p.name
                return p, display_name

        # 업로드 루트/<id_or_key> 가 파일이면 그대로
        cand_file = (UPLOADS_DIR / str(id_or_key)).resolve()
        if cand_file.is_file() and _safe_in(UPLOADS_DIR, cand_file):
            return cand_file, cand_file.name

        # 더 이상 찾을 수 없음
        return None, None

    # ── DB 매칭 로직
    batch_id = row.get("BATCH_ID")
    changed = row.get("CHANGED_FILENAME")
    original = row.get("ORIGINAL_FILENAME")

    if not batch_id:
        return None, original or changed

    base = (UPLOADS_DIR / str(batch_id)).resolve()
    if not (base.exists() and base.is_dir() and _safe_in(UPLOADS_DIR, base)):
        return None, original or changed

    # 1) CHANGED_FILENAME 우선
    for name in (changed, original):
        if name:
            cand = (base / name).resolve()
            if cand.is_file() and _safe_in(UPLOADS_DIR, cand):
                p = cand
                display_name = original or cand.name
                return p, display_name

    # 2) 폴더 내 최대 파일로 폴백
    p = _pick_largest_file(base)
    if p and _safe_in(UPLOADS_DIR, p):
        display_name = original or p.name
        return p, display_name

    return None, original or changed

# ── 요약 txt 찾기 ─────────────────────────────
def find_text(id_or_key: str) -> Optional[Path]:
    if not OCR_DIR:
        return None

    row = _fetch_doc_row(id_or_key)
    result_id = (row or {}).get("RESULT_FOLDER_ID") or id_or_key
    root = (OCR_DIR / str(result_id)).resolve()
    if not (root.exists() and root.is_dir() and _safe_in(OCR_DIR, root)):
        return None

    llm_dir = root / "llm"

    candidates = []
    search_iter = llm_dir.glob("*.txt") if llm_dir.exists() else root.rglob("*.txt")
    for p in search_iter:
        try:
            if p.is_file() and _safe_in(OCR_DIR, p):
                candidates.append(p.resolve())
        except Exception:
            continue

    if not candidates:
        return None

    def score(p: Path):
        name = p.name.lower()
        # summary.txt 최우선, 그 다음 'summary' 포함, 그 외
        if name == "summary.txt":
            return (0, len(name))
        if "summary" in name:
            return (1, len(name))
        return (2, len(name))

    candidates.sort(key=score)
    return candidates[0]

# ── 디버그 ─────────────────────────────
@router.get("/_where")
def where():
    return PlainTextResponse("\n".join([
        f"UPLOADS_DIR = {UPLOADS_DIR}",
        f"OCR_DIR     = {OCR_DIR}",
        f"REPO_DIR    = {REPO_DIR}",
    ]))

# ── 다운로드 ─────────────────────────────
@router.get("/{id_or_key}/original")
def get_original(id_or_key: str):
    p, display_name = find_original(id_or_key)
    if not p:
        raise HTTPException(404, detail=f"original not found for {id_or_key}")
    if not p.exists() or not p.is_file():
        raise HTTPException(404, detail=f"original path invalid for {id_or_key}")

    media_type, _ = mimetypes.guess_type(p.name)
    return FileResponse(
        path=str(p),
        media_type=media_type or "application/octet-stream",
        filename=display_name or p.name,  # 한글 파일명도 안전
    )

@router.get("/{id_or_key}/text")
def get_text(id_or_key: str):
    p = find_text(id_or_key)
    if not p:
        raise HTTPException(404, detail=f"summary txt not found for {id_or_key}")
    if not p.exists() or not p.is_file():
        raise HTTPException(404, detail=f"summary path invalid for {id_or_key}")

    return FileResponse(
        path=str(p),
        media_type="text/plain; charset=utf-8",
        filename=p.name
    )