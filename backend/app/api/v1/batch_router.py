# backend/app/api/v1/batch_router.py

from __future__ import annotations

import json
from pathlib import Path
from typing import Dict, List

from fastapi import APIRouter, HTTPException
from celery.result import AsyncResult

from workers.celery_app import celery_app  # Celery 인스턴스
from config import RESULT_DIR              # ✅ 절대 경로 사용
from utils.rcache import _r               # Redis 연결 재사용

router = APIRouter(prefix="/api/v1/batch", tags=["batch"])

def _batch_tasks_key(batch_id: str) -> str:
    return f"batch:{batch_id}:tasks"

def _load_task_ids_from_meta(batch_id: str) -> List[str]:
    """RESULT_DIR/{batch_id}.json에서 task_id 목록을 읽는다."""
    meta_path = Path(RESULT_DIR) / f"{batch_id}.json"
    if not meta_path.exists():
        raise HTTPException(status_code=404, detail="batch meta not found")

    try:
        meta = json.loads(meta_path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as e:
        raise HTTPException(status_code=500, detail=f"invalid batch meta: {e}")

    tasks = meta.get("tasks") or []
    ids = [t.get("task_id") for t in tasks if t.get("task_id")]
    return ids


@router.get("/status/{batch_id}")
def batch_status(batch_id: str):
    """
    각 배치의 전체 진행률과 상태 분포를 반환합니다.

    응답 예시:
    {
      "batch_id": "abcd1234",
      "total": 3,
      "done": 2,
      "progress": 0.6667,
      "by_state": { "PENDING": 0, "PROGRESS": 1, "STARTED": 0, "RETRY": 0, "FAILURE": 0, "REVOKED": 0, "SUCCESS": 2 },
      "source": "redis" | "meta"
    }
    """
    # 1) Redis 인덱스가 있으면 우선 사용
    redis_key = _batch_tasks_key(batch_id)
    ids: List[str] = []
    source = "redis"

    if _r.exists(redis_key):
        ids = _r.lrange(redis_key, 0, -1) or []
    else:
        # 2) 폴백: 메타 파일에서 task_ids 추출
        source = "meta"
        ids = _load_task_ids_from_meta(batch_id)

    total = len(ids)
    if total == 0:
        return {
            "batch_id": batch_id,
            "total": 0,
            "done": 0,
            "progress": 0.0,
            "by_state": {},
            "source": source,
        }

    # Celery 상태별 카운트(표준 + 우리가 쓰는 PROGRESS 포함)
    known_states = ["PENDING", "PROGRESS", "STARTED", "RETRY", "FAILURE", "REVOKED", "SUCCESS"]
    by_state: Dict[str, int] = {k: 0 for k in known_states}
    other_count = 0
    done = 0

    for tid in ids:
        r = AsyncResult(tid, app=celery_app)
        state = (r.state or "PENDING").upper()
        if state not in by_state:
            other_count += 1
            state = "PENDING"  # 알 수 없는 상태는 PENDING으로 흡수
        by_state[state] += 1
        if state in ("SUCCESS", "FAILURE", "REVOKED"):
            done += 1

    progress = round(done / total, 4)

    # 미지정 상태가 있었다면 by_state에 힌트 추가(선택)
    if other_count:
        by_state["PENDING"] += 0  # 키 보장
        # 필요하면 다음 라인으로 디버깅 힌트 남길 수 있음:
        # by_state["_OTHER"] = other_count

    return {
        "batch_id": batch_id,
        "total": total,
        "done": done,
        "progress": progress,
        "by_state": by_state,
        "source": source,
    }
