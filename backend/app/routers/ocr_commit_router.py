from __future__ import annotations
from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel
from pathlib import Path
from typing import Optional, Iterable
from sqlalchemy import text
from celery.result import AsyncResult
import os, json

# DB import (프로젝트 경로 자동 인식)
try:
    from core.db import engine
except Exception:
    from core.db import engine

# config.RESULT_DIR 최우선
try:
    from config import RESULT_DIR as _CFG_RESULT_DIR
except Exception:
    _CFG_RESULT_DIR = None

router = APIRouter(prefix="/api/v1/ocr", tags=["OCR"])

# -------------------------------------------------------------------
# 결과 JSON 위치 후보
# -------------------------------------------------------------------
def _default_result_roots() -> list[Path]:
    roots: list[Path] = []
    env_dir = os.getenv("RESULT_DIR")
    if _CFG_RESULT_DIR:
        roots.append(Path(_CFG_RESULT_DIR).resolve())
    if env_dir:
        roots.append(Path(env_dir).resolve())

    app_root = Path(__file__).resolve().parents[1]
    roots.append((app_root / "ocr_store" / "uploads").resolve())
    roots.append((app_root.parents[1] / "ocr_store" / "uploads").resolve())

    uniq, seen = [], set()
    for r in roots:
        s = str(r)
        if s not in seen:
            uniq.append(r)
            seen.add(s)
    return uniq

_CAND_FILENAMES = ("result.json", "summary.json", "meta.json", "task.json")

def _iter_candidates(roots: Iterable[Path], batch_id: str, task_id: str) -> Iterable[Path]:
    for r in roots:
        yield r / batch_id / f"{task_id}.json"
        tdir = r / batch_id / task_id
        for name in _CAND_FILENAMES:
            yield tdir / name
        if tdir.is_dir():
            for p in tdir.glob("*.json"):
                yield p

def _load_result(batch_id: str, task_id: str) -> dict:
    roots = _default_result_roots()
    for cand in _iter_candidates(roots, batch_id, task_id):
        if cand.exists():
            try:
                return json.loads(cand.read_text(encoding="utf-8"))
            except Exception:
                continue

    # Celery backend fallback
    app_ = None
    try:
        from workers.celery_app import celery as app_
    except Exception:
        from celery import current_app as app_
    try:
        res = AsyncResult(task_id, app=app_)
        if res.state == "SUCCESS" and res.result:
            if isinstance(res.result, dict):
                return res.result
            try:
                return json.loads(res.result)
            except Exception:
                return {"raw": str(res.result)}
    except Exception:
        pass

    raise FileNotFoundError(f"result json not found for {batch_id}/{task_id}")

def _resolve_result_dir(batch_id: str, task_id: str) -> Path:
    for root in _default_result_roots():
        tdir = root / batch_id / task_id
        if tdir.is_dir():
            return tdir
        bdir = root / batch_id
        if bdir.is_dir():
            return bdir / task_id
    return _default_result_roots()[0] / batch_id / task_id

# -------------------------------------------------------------------
# DB 헬퍼
# -------------------------------------------------------------------
DOC_TABLE = os.getenv("DOC_TABLE", "DOCUMENT")
USER_TABLE = os.getenv("APP_USER_TABLE", "app_user")

def _table_has_col(conn, table: str, col: str) -> bool:
    q = text("""
      SELECT 1 FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c
      LIMIT 1
    """)
    return conn.execute(q, {"t": table, "c": col}).first() is not None

def _col_nullable(conn, table: str, col: str) -> bool:
    q = text("""
      SELECT IS_NULLABLE
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = :t AND COLUMN_NAME = :c
      LIMIT 1
    """)
    row = conn.execute(q, {"t": table, "c": col}).first()
    return not row or str(row[0]).upper() != "NO"

def _lookup_user_id_by_login(conn, login_value: str) -> Optional[int]:
    id_col = "USER_ID" if _table_has_col(conn, USER_TABLE, "USER_ID") else "id"
    login_cols = [c for c in ("LOGIN_ID","EMAIL","USERNAME","NAME") if _table_has_col(conn, USER_TABLE, c)]
    for c in login_cols:
        row = conn.execute(text(f"SELECT {id_col} FROM {USER_TABLE} WHERE {c}=:v LIMIT 1"), {"v": login_value}).first()
        if row:
            return int(row[0])
    return None

def _owner_from_request(request: Request, conn=None) -> Optional[int]:
    token = request.headers.get("authorization") or request.cookies.get("access_token")
    if not token:
        return None
    payload = {}
    try:
        import jwt
        secret = os.getenv("JWT_SECRET")
        algs = os.getenv("JWT_ALGS", "HS256,RS256").split(",")
        payload = jwt.decode(token.split()[-1], secret, algorithms=algs, options={"verify_aud": False})
    except Exception:
        return None
    for key in ("user_id", "id", "sub"):
        v = payload.get(key)
        if v:
            try:
                return int(v)
            except Exception:
                return _lookup_user_id_by_login(conn, str(v))
    return None

# -------------------------------------------------------------------
# Upsert 로직
# -------------------------------------------------------------------
def _upsert_document(conn, payload: dict) -> int:
    rid = payload["RESULT_FOLDER_ID"]
    row = conn.execute(
        text(f"SELECT DOCUMENT_ID FROM {DOC_TABLE} WHERE RESULT_FOLDER_ID=:rid LIMIT 1"),
        {"rid": rid},
    ).first()
    if row:
        doc_id = int(row[0])
        updates, params = [], {"id": doc_id}
        for c in payload:
            if _table_has_col(conn, DOC_TABLE, c):
                updates.append(f"{c}=:{c}")
                params[c] = payload[c]
        if updates:
            sql = f"UPDATE {DOC_TABLE} SET {', '.join(updates)} WHERE DOCUMENT_ID=:id"
            conn.execute(text(sql), params)
        return doc_id

    # 신규 삽입
    cols = [c for c in payload.keys() if _table_has_col(conn, DOC_TABLE, c)]
    sql = f"INSERT INTO {DOC_TABLE} ({','.join(cols)}) VALUES ({','.join([f':{c}' for c in cols])})"
    conn.execute(text(sql), payload)
    return int(conn.execute(text("SELECT LAST_INSERT_ID()")).scalar())

# -------------------------------------------------------------------
# 모델
# -------------------------------------------------------------------
class CommitReq(BaseModel):
    batch_id: str
    task_id: str
    original_filename: Optional[str] = None
    file_size_bytes: Optional[int] = 0
    owner_user_id: Optional[int] = None
    title: Optional[str] = None

# -------------------------------------------------------------------
# 엔드포인트
# -------------------------------------------------------------------
@router.post("/commit")
def commit(req: CommitReq, request: Request):
    data = _load_result(req.batch_id, req.task_id)

    # ----- 필드 정리 -----
    original_filename = (
        req.original_filename or data.get("original_filename") or data.get("filename")
    )
    changed_filename = data.get("changed_filename")
    file_path = data.get("file_path")
    summary = (data.get("summary_two_lines") or data.get("summary") or "").strip()
    category = data.get("category_name") or data.get("category")
    pages = data.get("pages") or None
    sha = data.get("sha") or None
    title = req.title or data.get("title") or (original_filename or "").rsplit(".", 1)[0]
    result_folder_id = f"{req.batch_id}/{req.task_id}"

    result_dir = _resolve_result_dir(req.batch_id, req.task_id)
    (result_dir / "llm").mkdir(parents=True, exist_ok=True)
    summary_rel = Path("llm") / "summary.txt"
    (result_dir / summary_rel).write_text(summary, encoding="utf-8")
    meta_rel = Path("meta.json")
    meta_obj = dict(data)
    meta_obj["committed"] = True
    (result_dir / meta_rel).write_text(json.dumps(meta_obj, ensure_ascii=False, indent=2), encoding="utf-8")

    payload = {
        "ORIGINAL_FILENAME": original_filename,
        "CHANGED_FILENAME": changed_filename,
        "FILE_SIZE_BYTES": req.file_size_bytes or 0,
        "CATEGORY_NAME": category,
        "LLM_SUMMARY_TEXT": summary,
        "RESULT_FOLDER_ID": result_folder_id,
        "PROC_STATUS": "SUMM_DONE",
        "TITLE": title,
        "OWNER_USER_ID": req.owner_user_id,
        "PAGES": pages,
        "SHA": sha,
        "BATCH_ID": req.batch_id,
        "TASK_ID": req.task_id,
        "SUMMARY_TXT_RELPATH": str(summary_rel).replace("\\", "/"),
        "METADATA_JSON_RELPATH": str(meta_rel).replace("\\", "/"),
    }

    try:
        with engine.begin() as conn:
            if _table_has_col(conn, DOC_TABLE, "OWNER_USER_ID"):
                if not payload["OWNER_USER_ID"] and not _col_nullable(conn, DOC_TABLE, "OWNER_USER_ID"):
                    resolved = _owner_from_request(request, conn)
                    if not resolved:
                        raise HTTPException(400, "OWNER_USER_ID required or invalid token")
                    payload["OWNER_USER_ID"] = resolved

            doc_id = _upsert_document(conn, payload)
    except Exception as e:
        raise HTTPException(500, f"commit failed: {e}")

    return {
        "ok": True,
        "document_id": doc_id,
        "result_folder_id": result_folder_id,
        "summary_relpath": str(summary_rel),
        "metadata_relpath": str(meta_rel),
        "original_filename": original_filename,
        "changed_filename": changed_filename,
    }