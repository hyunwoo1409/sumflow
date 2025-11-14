# backend/app/utils/zip_handler.py

from __future__ import annotations
import shutil
from pathlib import Path
from config import RESULT_DIR

def build_batch_zip(batch_id: str) -> str:
    """
    RESULT_DIR/{batch_id} 디렉토리의 모든 결과(JSON 등)를 ZIP으로 묶어 반환.
    이미 존재하면 재생성(덮어쓰기).
    
    Returns:
        zip_path (str): 생성된 ZIP 파일의 절대 경로
    Raises:
        FileNotFoundError: batch_id 디렉토리가 없거나 비어 있는 경우
    """
    batch_dir = Path(RESULT_DIR) / batch_id
    if not batch_dir.exists() or not batch_dir.is_dir():
        raise FileNotFoundError(f"no such batch results dir: {batch_dir}")

    # 결과 파일이 하나도 없으면 오류
    files = list(batch_dir.glob("*"))
    if not files:
        raise FileNotFoundError(f"empty batch result dir: {batch_dir}")

    # base_name = zip 확장자 제외 경로 (shutil.make_archive 요구사항)
    zip_base = batch_dir.parent / batch_id
    zip_path = str(zip_base) + ".zip"

    # 기존 zip 제거 후 새로 생성
    p = Path(zip_path)
    if p.exists():
        p.unlink()

    # shutil.make_archive는 확장자 제외 base_name 사용해야 함
    shutil.make_archive(str(zip_base), "zip", root_dir=batch_dir)

    return str(zip_path)
