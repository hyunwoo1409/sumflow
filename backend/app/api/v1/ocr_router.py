# backend/app/api/v1/ocr_router.py

from __future__ import annotations

import os
import json
from uuid import uuid4
from typing import List, Optional
from pathlib import Path
from zipfile import ZipFile, BadZipFile

from fastapi import APIRouter, UploadFile, File, HTTPException, Query
from fastapi.responses import FileResponse, PlainTextResponse, StreamingResponse

from config import RESULT_DIR, ZIP_MAX_FILES, ZIP_MAX_BYTES, ALLOWED_SINGLE_EXTS
from utils.file_manager import save_upload            # (abs_path, saved_name, sha) <- save_upload(upfile, batch_id)
from workers.tasks import process_pdf                 # Celery task
from utils.rcache import get_ocr_text, _r             # Redis 연결 재사용
from utils.zip_handler import build_batch_zip         # ZIP 생성기

router = APIRouter(prefix="/api/v1/ocr", tags=["ocr"])

ASYNC_ONLY = os.getenv("ASYNC_ONLY", "true").lower() == "true"
MAX_FILES = int(os.getenv("MAX_FILES", "50"))
MAX_BATCH_BYTES = int(os.getenv("MAX_BATCH_BYTES", "200000000"))  # 200MB

def _batch_tasks_key(batch_id: str) -> str:
    return f"batch:{batch_id}:tasks"


@router.post("/upload")
async def upload(files: List[UploadFile] = File(...)):
    """
    응답 스키마:
    {
      "batch_id": "<string>",
      "tasks": [
        { "task_id": "<uuid>", "filename": "<str>", "sha": "<short-sha>" }
      ]
    }
    """
    if not files:
        raise HTTPException(status_code=400, detail="no files")
    if not ASYNC_ONLY:
        raise HTTPException(status_code=503, detail="Server misconfig: async only expected")
    if len(files) > MAX_FILES:
        raise HTTPException(status_code=413, detail=f"too many files ({len(files)}/{MAX_FILES})")

    batch_id = uuid4().hex[:16]
    task_items: List[dict] = []

    # 총 용량 간이 체크 (헤더 기반, 일부 클라이언트는 미제공 가능)
    total_bytes = 0
    for f in files:
        size_hdr = f.headers.get("content-length")
        if size_hdr and size_hdr.isdigit():
            total_bytes += int(size_hdr)
            if total_bytes > MAX_BATCH_BYTES:
                raise HTTPException(status_code=413, detail=f"batch size exceeds limit ({MAX_BATCH_BYTES} bytes)")

    for f in files:
        # ✅ 인자 순서 복구: save_upload(upfile, batch_id)
        abs_path, saved_name, sha = await save_upload(f, batch_id)

        # Celery 큐 투입
        t = process_pdf.delay(
            file_path=abs_path,     # 절대경로
            filename=saved_name,    # 정규화 저장명
            batch_id=batch_id,
            sha=sha,
        )

        # 배치 인덱싱(집계용)
        _r.rpush(_batch_tasks_key(batch_id), t.id)

        task_items.append({
            "task_id": t.id,
            "filename": saved_name,
            "sha": sha,
        })

    # 업로드 메타 저장 (참고용)
    meta_path = Path(RESULT_DIR) / f"{batch_id}.json"
    meta_path.parent.mkdir(parents=True, exist_ok=True)
    meta_path.write_text(json.dumps({
        "batch_id": batch_id,
        "tasks": task_items,
    }, ensure_ascii=False, indent=2), encoding="utf-8")

    return {"batch_id": batch_id, "tasks": task_items}


@router.get("/raw/{task_id}")
def get_ocr_raw(task_id: str, download: bool = False):
    """
    OCR 원문 텍스트 on-demand 제공 (Redis 임시 캐시에서 조회).
    - 존재하지 않으면 404
    - ?download=true 로 파일 다운로드 응답
    """
    text = get_ocr_text(task_id)
    if text is None:
        raise HTTPException(status_code=404, detail="ocr text not found (expired or not cached)")

    if download:
        def iter_chunks():
            yield text.encode("utf-8")
        return StreamingResponse(
            iter_chunks(),
            media_type="text/plain; charset=utf-8",
            headers={"Content-Disposition": f'attachment; filename="{task_id}.ocr.txt"'},
        )

    return PlainTextResponse(text, media_type="text/plain; charset=utf-8")


@router.get("/export")
def export_zip(batch: str = Query(..., description="batch_id 값")):
    """
    결과 ZIP 다운로드.
    프론트 호출: GET /api/v1/ocr/export?batch=<batch_id>
    결과 ZIP 경로 규칙: {RESULT_DIR}/{batch}.zip
    - 없으면 즉석 생성 시도(build_batch_zip)
    """
    # 없으면 생성 시도
    zip_path = Path(RESULT_DIR) / f"{batch}.zip"
    if not zip_path.exists():
        try:
            built = build_batch_zip(batch)
            zip_path = Path(built)
        except FileNotFoundError:
            raise HTTPException(status_code=404, detail="Result zip not found and cannot be created")

    return FileResponse(
        str(zip_path),
        filename=f"{batch}.zip",
        media_type="application/zip",
    )


@router.post("/upload-zip")
async def upload_zip(file: UploadFile = File(...), batch_id: Optional[str] = None):
    batch = batch_id or uuid4().hex[:12]
    if not file.filename.lower().endswith('.zip'):
        raise HTTPException(status_code=400, detail={"ok": False, "error": "not_zip"})
    data = await file.read()
    if len(data) > ZIP_MAX_BYTES:
        raise HTTPException(status_code=413, detail={"ok": False, "error": "zip_too_large", "limit": ZIP_MAX_BYTES})
    from io import BytesIO
    try:
        zf = ZipFile(BytesIO(data))
    except BadZipFile:
        raise HTTPException(status_code=400, detail={"ok": False, "error": "bad_zip"})
    infos = [i for i in zf.infolist() if not i.is_dir()]
    if len(infos) == 0:
        raise HTTPException(status_code=400, detail={"ok": False, "error": "zip_empty"})
    if len(infos) > ZIP_MAX_FILES:
        raise HTTPException(status_code=413, detail={"ok": False, "error": "too_many_files", "limit": ZIP_MAX_FILES})
    enqueued = []
    errors = []
    for info in infos:
        name = Path(info.filename).name
        if Path(name).suffix.lower() not in ALLOWED_SINGLE_EXTS:
            errors.append({"name": name, "error": "invalid_ext"}); continue
        content = zf.read(info)
        from starlette.datastructures import UploadFile as SUploadFile
        up = SUploadFile(filename=name, file=BytesIO(content))
        try:
            abs_path, saved_name, sha = await save_upload(up, batch)
            task = process_pdf.delay(batch, saved_name)
            enqueued.append({"name": name, "task_id": task.id})
        except Exception as e:
            errors.append({"name": name, "error": "upload_failed", "detail": str(e)})
    return {"ok": len(enqueued) > 0, "batch": batch, "files": enqueued, "errors": errors}
