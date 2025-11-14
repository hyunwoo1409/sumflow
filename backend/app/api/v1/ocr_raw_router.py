# backend/app/api/v1/ocr_raw_router.py
import os
from fastapi import APIRouter, HTTPException
from fastapi.responses import PlainTextResponse
from utils.rcache import get_ocr_text

router = APIRouter(prefix="/api/v1/ocr/raw", tags=["ocr-raw"])

@router.get("/{task_id}", response_class=PlainTextResponse)
def get_raw_ocr(task_id: str):
    """
    OCR 원문을 Redis 캐시에서 조회
    - URL: GET /api/v1/ocr/raw/{task_id}
    - Response: text/plain (OCR 결과 문자열)
    """
    if not task_id:
        raise HTTPException(status_code=400, detail="task_id required")

    text = get_ocr_text(task_id)
    if not text:
        raise HTTPException(status_code=404, detail="OCR text not found or expired")

    return text
