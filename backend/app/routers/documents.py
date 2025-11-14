from fastapi import APIRouter, Depends, HTTPException, Body  # UPDATED
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import update, func
from typing import List, Dict  # UPDATED
from datetime import datetime
import time  # NEW

from core.db import get_db
from models.document_model import Document
from models.comment_model import DocComment
from core.security import get_current_user

# NEW: Celery 연결 (진행도 조회용)
from workers.celery_app import celery  # NEW

router = APIRouter(prefix="/api/v1", tags=["Documents"])

# ---------- Schemas ----------
class MemoCreate(BaseModel):
    body: str

class MemoOut(BaseModel):
    id: int
    body: str
    createdAt: datetime

class SimpleOK(BaseModel):
    success: bool = True

# ---------- 유틸(소프트 삭제 유지) ----------
def soft_delete_document(db: Session, doc: Document):
    if hasattr(doc, "PROC_STATUS"):
        doc.PROC_STATUS = "DELETED"
    if hasattr(doc, "IS_DELETED"):
        doc.IS_DELETED = True
    if hasattr(doc, "UPDATED_AT"):
        doc.UPDATED_AT = func.now()
    db.add(doc)
    db.query(DocComment).filter(DocComment.DOCUMENT_ID == doc.DOCUMENT_ID)\
        .update({"IS_DELETED": True, "UPDATED_AT": func.now()})

# ========== PROGRESS (NEW) ==========
def _calc_progress(async_result) -> Dict:  # NEW
    state = async_result.state
    info = async_result.info or {}
    now = time.time()

    if state in ("PENDING", "RECEIVED"):
        return {"state": state, "percent": 0, "eta_seconds": None, "finish_at": None, "stage": "queued"}

    if state == "PROGRESS":
        current = int(info.get("current", 0))
        total   = max(1, int(info.get("total", 100)))
        start   = float(info.get("start_time", now))
        elapsed = max(0.001, now - start)
        done_ratio = max(0.0, min(1.0, current / total))
        if current > 0:
            remain_ratio = max(0.0, 1.0 - done_ratio)
            eta = (elapsed / done_ratio) * remain_ratio
            finish_at = int(now + eta)
        else:
            eta, finish_at = None, None
        return {
            "state": state,
            "stage": info.get("stage", "working"),
            "percent": int(done_ratio * 100),
            "eta_seconds": int(eta) if eta is not None else None,
            "finish_at": finish_at,
            "detail": info.get("detail"),
            "filename": info.get("filename"),
        }

    if state == "SUCCESS":
        return {"state": "SUCCESS", "percent": 100, "eta_seconds": 0, "finish_at": int(now)}

    if state in ("FAILURE", "REVOKED"):
        # detail에 예외 정보가 담길 수 있음
        return {"state": state, "percent": None, "eta_seconds": None, "finish_at": None}

    return {"state": state, "percent": None, "eta_seconds": None, "finish_at": None}

@router.get("/progress/{task_id}")  # NEW: 단일 폴링
def get_progress(task_id: str):
    return _calc_progress(celery.AsyncResult(task_id))

@router.post("/progress/batch")  # NEW: 배치 폴링
def get_progress_batch(payload: dict = Body(...)):
    ids = payload.get("ids", [])
    out = {}
    for tid in ids:
        out[tid] = _calc_progress(celery.AsyncResult(tid))
    return {"results": out}

# ========== MEMO ==========
@router.get("/documents/{doc_id}/memos", response_model=List[MemoOut])
@router.get("/documents/{doc_id}/comments", response_model=List[MemoOut])  # 호환
def list_memos(doc_id: int, db: Session = Depends(get_db),
               current=Depends(get_current_user)):
    user_id = getattr(current, "USER_ID", current["USER_ID"])
    # 내 소유 문서인지 쿼리로 한정
    doc = db.query(Document).filter(
        Document.DOCUMENT_ID == doc_id,
        Document.OWNER_USER_ID == user_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    rows = db.query(DocComment).filter(
        DocComment.DOCUMENT_ID == doc_id,
        DocComment.IS_DELETED == False
    ).order_by(DocComment.CREATED_AT.desc()).all()

    return [MemoOut(id=r.COMMENT_ID, body=r.BODY, createdAt=r.CREATED_AT) for r in rows]

@router.post("/documents/{doc_id}/memos", response_model=MemoOut, status_code=201)
@router.post("/documents/{doc_id}/comments", response_model=MemoOut, status_code=201)  # 호환
def create_memo(doc_id: int, data: MemoCreate, db: Session = Depends(get_db),
                current=Depends(get_current_user)):
    user_id = getattr(current, "USER_ID", current["USER_ID"])
    if not data.body.strip():
        raise HTTPException(status_code=400, detail="메모 내용이 비었습니다.")

    # 내 문서에만 작성 가능
    doc = db.query(Document).filter(
        Document.DOCUMENT_ID == doc_id,
        Document.OWNER_USER_ID == user_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    new_c = DocComment(
        DOCUMENT_ID=doc_id,
        USER_ID=user_id,
        BODY=data.body.strip(),
        IS_DELETED=False,
        CREATED_AT=datetime.utcnow(),
        UPDATED_AT=datetime.utcnow(),
    )
    db.add(new_c)
    db.commit()
    db.refresh(new_c)
    return MemoOut(id=new_c.COMMENT_ID, body=new_c.BODY, createdAt=new_c.CREATED_AT)

@router.delete("/memos/{memo_id}", response_model=SimpleOK)
@router.delete("/comments/{memo_id}", response_model=SimpleOK)  # 호환
def delete_memo(memo_id: int, db: Session = Depends(get_db),
                current=Depends(get_current_user)):
    user_id = getattr(current, "USER_ID", current["USER_ID"])

    # 내 문서의 메모인지 확인을 "조인 없는 두 번 조회"로 안전하게 처리
    c = db.query(DocComment).filter(DocComment.COMMENT_ID == memo_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="메모를 찾을 수 없습니다.")

    owned = db.query(Document).filter(
        Document.DOCUMENT_ID == c.DOCUMENT_ID,
        Document.OWNER_USER_ID == user_id
    ).first()
    if not owned:
        # 이 화면은 내 것만 나오지만 혹시 모를 우회 방지
        raise HTTPException(status_code=404, detail="메모를 찾을 수 없습니다.")

    db.delete(c)
    db.commit()
    return SimpleOK()

# ========== DOCUMENT DELETE ==========
@router.delete("/documents/me", response_model=SimpleOK)
def delete_all_my_documents(db: Session = Depends(get_db),
                            current=Depends(get_current_user)):
    user_id = getattr(current, "USER_ID", current["USER_ID"])

    docs = db.query(Document).filter(Document.OWNER_USER_ID == user_id).all()
    for d in docs:
        soft_delete_document(db, d)
    db.commit()
    return SimpleOK()

@router.delete("/documents/{doc_id}", response_model=SimpleOK)
def delete_document(doc_id: int, db: Session = Depends(get_db),
                    current=Depends(get_current_user)):
    user_id = getattr(current, "USER_ID", current["USER_ID"])
    # 내 문서만 대상
    doc = db.query(Document).filter(
        Document.DOCUMENT_ID == doc_id,
        Document.OWNER_USER_ID == user_id
    ).first()
    if not doc:
        raise HTTPException(status_code=404, detail="문서를 찾을 수 없습니다.")

    # 소프트 삭제
    soft_delete_document(db, doc)
    db.commit()
    return SimpleOK()

@router.delete("/documents/comments/{memo_id}", response_model=SimpleOK)
def delete_memo_alias(memo_id: int, db: Session = Depends(get_db),
                      current=Depends(get_current_user)):
    user_id = getattr(current, "USER_ID", current["USER_ID"])

    c = db.query(DocComment).filter(DocComment.COMMENT_ID == memo_id).first()
    if not c:
        raise HTTPException(status_code=404, detail="메모를 찾을 수 없습니다.")

    owned = db.query(Document).filter(
        Document.DOCUMENT_ID == c.DOCUMENT_ID,
        Document.OWNER_USER_ID == user_id
    ).first()
    if not owned:
        raise HTTPException(status_code=404, detail="메모를 찾을 수 없습니다.")

    db.delete(c)
    db.commit()
    return SimpleOK()