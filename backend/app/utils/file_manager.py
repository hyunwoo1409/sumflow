# app/utils/file_manager.py
from __future__ import annotations

# --- extension allowlist ---

def _is_allowed_ext(filename: str) -> bool:
    return Path(filename).suffix.lower() in ALLOWED_SINGLE_EXTS

import re, unicodedata, hashlib
from pathlib import Path
from config import ALLOWED_SINGLE_EXTS
from typing import Tuple, Optional

import aiofiles
from config import UPLOAD_DIR

_SAFE = r"[^0-9A-Za-z가-힣._-]+"  # 허용 문자 외는 전부 "_"

def sanitize_filename(name: str) -> str:
    """한글 조합형, 공백, 특수문자, 경로문자 전부 정규화"""
    n = unicodedata.normalize("NFC", name or "file.pdf").strip()
    n = n.replace("/", "_").replace("\\", "_").replace("..", "_")
    n = re.sub(r"\s+", " ", n)
    n = re.sub(_SAFE, "_", n)
    n = re.sub(r"_+", "_", n)
    return n if n else "file.pdf"

def _dedupe_path(target: Path) -> Path:
    """이미 존재하면 _1, _2 ... 접미사를 붙여 충돌 회피"""
    if not target.exists():
        return target
    stem, suffix = target.stem, target.suffix
    parent = target.parent
    i = 1
    while True:
        cand = parent / f"{stem}_{i}{suffix}"
        if not cand.exists():
            return cand
        i += 1

async def save_upload(upfile, batch_id: str) -> tuple[str, str, str]:
    """
    returns (abs_path, saved_name, sha12)
    - 저장 위치: {UPLOAD_DIR}/{batch_id}/{saved_name}
    - 동일 파일명 존재 시 자동 번호 접미사 부여
    """
    batch_dir = Path(UPLOAD_DIR) / batch_id
    batch_dir.mkdir(parents=True, exist_ok=True)

    original = getattr(upfile, "filename", "file.pdf")
    saved_name = sanitize_filename(original)
    abs_path = (batch_dir / saved_name).resolve()

    # 경로 탈출 방지: 반드시 batch_dir 하위여야 함
    try:
        abs_path.relative_to(batch_dir.resolve())
    except Exception:
        # 비정상 경로면 강제로 batch_dir로 교정
        abs_path = (batch_dir / "file.pdf").resolve()
        saved_name = "file.pdf"

    # 동명이인 방지
    abs_path = _dedupe_path(abs_path)
    saved_name = abs_path.name  # 접미사가 붙었을 수 있음

    # 파일 저장 + 내용 기반 SHA 계산
    sha256 = hashlib.sha256()
    try:
        # 포인터를 파일 시작으로
        await upfile.seek(0)
    except Exception:
        pass

    async with aiofiles.open(abs_path, "wb") as f:
        while True:
            chunk = await upfile.read(1024 * 1024)
            if not chunk:
                break
            sha256.update(chunk)
            await f.write(chunk)

    sha = sha256.hexdigest()[:12]
    return str(abs_path), saved_name, sha
