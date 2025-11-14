# backend/app/api/v1/task_router.py
from __future__ import annotations

from fastapi import APIRouter
from fastapi.responses import JSONResponse
from celery.result import AsyncResult
from pathlib import Path
import os
import json

router = APIRouter(prefix="/api/v1/task", tags=["Task"])

# === Celery 인스턴스 안전 로드 ===
def _get_celery_app():
    """
    workers/celery_app.py 안에서 인스턴스 명칭이 'celery' 또는 'celery_app' 어느 쪽이든
    안전하게 로드하고, 둘 다 실패하면 현재 프로세스의 default app을 사용한다.
    """
    try:
        # 일반적으로 많이 쓰는 이름
        from workers.celery_app import celery as _app
        return _app
    except Exception:
        try:
            # 프로젝트에 따라 이렇게 쓰는 경우 존재
            from workers.celery_app import celery_app as _app
            return _app
        except Exception:
            # 최후의 수단
            from celery import current_app as _app
            return _app

_celery = _get_celery_app()

# === 파일 기반 fallback ===
RESULT_DIR = Path(os.getenv("RESULT_DIR", "ocr_store/uploads")).resolve()

def _find_result_path_by_task(task_id: str) -> Path | None:
    """
    RESULT_DIR/<batch>/<task_id>.json 을 모를 때를 대비해,
    1단계(배치 디렉토리)만 빠르게 훑어서 <task_id>.json이 있으면 반환한다.
    """
    if not RESULT_DIR.exists():
        return None
    try:
        for batch in RESULT_DIR.iterdir():
            if not batch.is_dir():
                continue
            cand = batch / f"{task_id}.json"
            if cand.exists():
                return cand
    except Exception:
        pass
    return None

def _json_response(payload: dict) -> JSONResponse:
    # 브라우저 캐시 / 프리플라이트 이슈 방지
    return JSONResponse(
        payload,
        headers={
            "Cache-Control": "no-store",
            "Pragma": "no-cache",
            "Vary": "Origin",
        },
    )

@router.get("/status/{task_id}")
def get_task_status(task_id: str):
    """
    표준 스키마 + 파일 기반 fallback.
    Celery가 SUCCESS를 바로 못 올려줘도 결과 JSON이 있으면 SUCCESS로 확정한다.

    응답 스키마(프론트 폴링 종료 조건과 호환):
    {
      "state": "SUCCESS|PENDING|STARTED|FAILURE|RETRY|REVOKED",
      "status": same_as_state,
      "result": {...} or {"error": "..."} or {"raw": "..."},
      "ready": bool,
      "successful": bool,
      "task_id": str
    }
    """
    # 1) Celery 우선 조회
    res = AsyncResult(task_id, app=_celery)
    state = (res.state or "").upper()

    if state == "SUCCESS":
        payload = res.result
        if isinstance(payload, (bytes, str)):
            try:
                payload = json.loads(payload)
            except Exception:
                payload = {"raw": payload}
        return _json_response({
            "state": state, "status": state, "result": payload,
            "ready": True, "successful": True, "task_id": task_id,
        })

    # 2) 파일 fallback: RESULT_DIR/*/<task_id>.json 이 있으면 SUCCESS로 간주
    cand = _find_result_path_by_task(task_id)
    if cand:
        try:
            data = json.loads(cand.read_text(encoding="utf-8"))
        except Exception:
            data = {"raw_path": str(cand)}
        return _json_response({
            "state": "SUCCESS", "status": "SUCCESS", "result": data,
            "ready": True, "successful": True, "task_id": task_id,
        })

    # 3) 실패/취소면 에러 포함
    payload = None
    if state in ("FAILURE", "REVOKED"):
        payload = {"error": str(res.result)}

    # 4) 아직 진행 중
    return _json_response({
        "state": state, "status": state, "result": payload,
        "ready": res.ready(), "successful": (state == "SUCCESS"),
        "task_id": task_id,
    })