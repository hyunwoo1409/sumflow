# backend/app/utils/rcache.py
from __future__ import annotations

import os
import redis
from typing import Optional, Dict

def _redis_url() -> str:
    return (
        os.getenv("REDIS_URL")
        or os.getenv("CELERY_BROKER_URL")
        or "redis://localhost:6379/0"
    )

# decode_responses=True → str 입출력
_r = redis.Redis.from_url(_redis_url(), decode_responses=True)

def ocr_key(task_id: str) -> str:
    return f"ocr:{task_id}"

def set_ocr_text(task_id: str, text: str, ttl: int | None = None, meta: dict | None = None) -> None:
    """OCR 원문과 (옵션) 메타를 Hash로 저장, TTL 지정 가능."""
    if not task_id or text is None:
        return
    try:
        key = ocr_key(task_id)
        data = {"text": text}
        if meta:
            data.update(meta)
        _r.hset(key, mapping=data)
        if ttl and ttl > 0:
            _r.expire(key, ttl)
    except Exception:
        # Redis 장애 시 파이프라인 중단하지 않음
        pass

def get_ocr_text(task_id: str) -> Optional[str]:
    """저장된 OCR 원문 텍스트만 반환. 없거나 오류면 None."""
    if not task_id:
        return None
    try:
        data = _r.hgetall(ocr_key(task_id))
        return data.get("text")
    except Exception:
        return None

def get_ocr_entry(task_id: str) -> Optional[Dict[str, str]]:
    """전체 Hash 반환. 없거나 오류면 None."""
    if not task_id:
        return None
    try:
        data = _r.hgetall(ocr_key(task_id))
        return data or None
    except Exception:
        return None

def del_ocr_text(task_id: str) -> None:
    """키 삭제 (없어도 조용히 무시)."""
    if not task_id:
        return
    try:
        _r.delete(ocr_key(task_id))
    except Exception:
        pass
