# main.py
import os, io, uuid, zipfile, jwt
import logging, traceback
from typing import List
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import StreamingResponse, JSONResponse
from pydantic import BaseModel
from pathlib import Path
import json, time, re, unicodedata
from sqlalchemy import text

# ✅ .env 자동 로드
from dotenv import load_dotenv
load_dotenv()

# ✅ 비동기 친화: 동기 함수 워커 스레드로
import anyio

from services.ocr import ocr_funnel_extract, batch_ocr_zip
from services.llm import summarize_and_categorize
from utils.version import get_version
from utils.telemetry import Telemetry, PerfRecorder
from core.db import SessionLocal
from core.security import decode_access_token
from models.visitlog_model import VisitLog
from models.user_model import AppUser


logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[logging.StreamHandler()]
)
logger = logging.getLogger("app")

APP_NAME = "ocr-llm-suite"
SESS_ROOT = "tmp/sessions"

app = FastAPI(title=APP_NAME)

@app.middleware("http")
async def _visit_logger(request: Request, call_next):
    path = request.url.path
    path_norm = (path.rstrip("/") or "/")
    # 내부 문서/스키마는 제외
    if path.startswith("/docs") or path.startswith("/redoc") or path.startswith("/openapi"):
        return await call_next(request)

    # GET/HEAD만 방문 로그 (필요시 POST 포함 가능)
    if request.method in ("GET", "HEAD"):
        db = SessionLocal()
        try:
            # 토큰에서 user_id 추출 (+ sub=LOGIN_ID fallback)
            user_id = None
            auth = request.headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                token = auth.split(" ", 1)[1]
                secret = os.getenv("JWT_SECRET", "mysecretkey")  # ← login.py의 기본값과 동일하게
                try:
                    payload = jwt.decode(token, secret, algorithms=["HS256"])
                    user_id = payload.get("user_id")
                    if not user_id and payload.get("sub"):
                        login_id = payload["sub"]
                        u = db.query(AppUser).filter(AppUser.LOGIN_ID == login_id).first()
                        if u:
                            user_id = u.USER_ID
                except Exception:
                    user_id = None
                if user_id:
                    db.execute(
                        text("""
                            INSERT INTO VISIT_LOG (USER_ID)
                            SELECT :uid
                            WHERE NOT EXISTS (
                                SELECT 1
                                FROM VISIT_LOG
                                WHERE USER_ID = :uid
                                AND DATE(VISITED_AT) = CURRENT_DATE
                            )
                        """),
                        {"uid": user_id},
                    )
            db.commit()
        except Exception:
            db.rollback()
        finally:
            db.close()

    return await call_next(request)

# === 원본 저장소 유틸 ===
STORE_DIR = Path("tmp/ocr_store")
STORE_DIR.mkdir(parents=True, exist_ok=True)

def _store_doc(doc_id: str, payload: dict):
    (STORE_DIR / f"{doc_id}.json").write_text(json.dumps(payload, ensure_ascii=False), encoding="utf-8")

def _load_doc(doc_id: str) -> dict:
    p = STORE_DIR / f"{doc_id}.json"
    if not p.exists():
        raise FileNotFoundError(doc_id)
    return json.loads(p.read_text(encoding="utf-8"))

# ================================================================
# 👇 Ollama 환경변수 확인 로그 (서버 실행 시 콘솔에 표시)
# ================================================================
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "llama3")
OLLAMA_HOST = os.getenv("OLLAMA_HOST", "http://localhost:11434")
logger.info(f"🧠 Using Ollama model: {OLLAMA_MODEL}")
logger.info(f"🌐 Ollama host: {OLLAMA_HOST}")
# ================================================================

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# === 요청 바디 모델 ===
class CompareRequest(BaseModel):
    left_text: str
    right_text: str

class CompareByIdRequest(BaseModel):
    left_id: str
    right_id: str
    mode: str = "text"  # 현재는 원본문 텍스트 비교. 추후 visual(SSIM) 확장 가능.

# === 헬스/버전 ===
@app.get("/healthz")
def healthz():
    return {"status": "ok"}

@app.get("/version")
def version():
    return {"version": get_version(), "name": APP_NAME}

# === 서버 기동 시 프리워밍 ===
@app.on_event("startup")
async def _warm_llm():
    try:
        logger.info("🔥 Warming up LLM model...")
        # 워밍업은 이벤트 루프 블로킹 방지를 위해 스레드로
        await anyio.to_thread.run_sync(summarize_and_categorize, "warmup")
        logger.info("🔥 LLM warmup complete.")
    except Exception as e:
        logger.warning(f"🔥 LLM warmup failed: {e}")

# === 업로드: OCR -> LLM -> 저장(doc_id) ===
@app.post("/api/v1/ocr/upload")
async def upload(files: List[UploadFile] = File(...)):
    perf = PerfRecorder(enabled=os.getenv("PERF_ENABLED", "false").lower() == "true")
    telemetry = Telemetry()
    results = []

    for f in files:
        content = await f.read()
        key = f.filename or f"file-{uuid.uuid4()}.bin"

        logger.info(f"📥 RECEIVED FILE: {key}, size={len(content)} bytes")

        try:
            with perf.step(f"ocr:{key}"):
                logger.info(f"🔍 START OCR: {key}")
                # ⬇️ OCR은 동기 함수 (문제 없음)
                text, pages, meta, per_page_texts = ocr_funnel_extract(content, filename=key, mode="quality")
                logger.info(f"✅ DONE OCR: {key} ({pages} pages)")
        except Exception as e:
            logger.exception(f"❌ OCR failed for {key}: {e}")
            raise HTTPException(status_code=500, detail=f"OCR failed for {key}: {e}")

        try:
            with perf.step(f"llm:{key}"):
                logger.info(f"🧠 START LLM: {key}")
                # ⬇️ 동기 summarize를 워커 스레드에서 실행하여 이벤트 루프 블로킹 방지
                summary = await anyio.to_thread.run_sync(summarize_and_categorize, text)
                logger.info(f"✅ DONE LLM: {key}")
        except Exception as e:
            logger.exception(f"❌ LLM failed for {key}: {e}")
            raise HTTPException(status_code=500, detail=f"LLM failed for {key}: {e}")

        # ✅ OCR/LLM 끝난 직후 원본문 저장 + doc_id 생성 (meta/per_page 포함)
        doc_id = str(uuid.uuid4())
        _store_doc(doc_id, {
            "doc_id": doc_id,
            "filename": key,
            "pages": pages,
            "full_text": text,
            "per_page": per_page_texts,  # 페이지별 텍스트/텍스트 레이어 여부
            "meta": meta,                # coverage, mode 등
            "summary": summary,
            "ts": int(time.time()),
        })

        # ✅ 응답에도 doc_id 포함
        results.append({
            "doc_id": doc_id,
            "filename": key,
            "pages": pages,
            "rawTextPreview": (text[:1200] + "...") if len(text) > 1200 else text,
            "summary": summary,
        })

    telemetry.merge(perf.to_telemetry())
    logger.info("📦 Upload batch complete. Returning response.")
    # OCR 끝난 직후
    logger.info(f"🧾 OCR text length: {len(text)} chars; preview={repr((text or '')[:120])}")

    return {"results": results, "telemetry": telemetry.data}

# === (기존) 텍스트 직접 비교 API ===
@app.post("/api/v1/ocr/compare")
def compare(payload: CompareRequest):
    a = payload.left_text or ""
    b = payload.right_text or ""
    set_a = set(a.split())
    set_b = set(b.split())
    only_a = sorted(list(set_a - set_b))[:100]
    only_b = sorted(list(set_b - set_a))[:100]
    overlap = sorted(list(set_a & set_b))[:100]
    return {
        "left_unique_terms_preview": only_a,
        "right_unique_terms_preview": only_b,
        "overlap_terms_preview": overlap,
        "left_len": len(a),
        "right_len": len(b),
    }

# === (신규) 원본(doc_id) 기준 비교 API ===
@app.post("/api/v1/ocr/compare_by_id")
def compare_by_id(payload: CompareByIdRequest):
    left = _load_doc(payload.left_id)
    right = _load_doc(payload.right_id)

    def norm(s: str) -> str:
        s = unicodedata.normalize("NFC", s)
        s = re.sub(r"[ \t]+", " ", s)
        s = re.sub(r"\n{2,}", "\n", s)
        return s.strip()

    a = norm(left.get("full_text", "") or "")
    b = norm(right.get("full_text", "") or "")

    ta = re.findall(r"\w+", a)
    tb = re.findall(r"\w+", b)
    sa, sb = set(ta), set(tb)

    return {
        "mode": "text",
        "left_len": len(a),
        "right_len": len(b),
        "jaccard_overlap": round(len(sa & sb) / max(1, len(sa | sb)), 4),
        "left_unique_terms_preview": sorted(list(sa - sb))[:100],
        "right_unique_terms_preview": sorted(list(sb - sa))[:100],
    }

# === ZIP 일괄 업로드 ===
@app.post("/api/v1/ocr/zip")
async def upload_zip(zip_file: UploadFile = File(...)):
    perf = PerfRecorder(enabled=os.getenv("PERF_ENABLED", "false").lower() == "true")
    telemetry = Telemetry()
    data = await zip_file.read()
    memzip = io.BytesIO()
    with zipfile.ZipFile(memzip, 'w', zipfile.ZIP_DEFLATED) as zout:
        for name, text, pages in batch_ocr_zip(data):
            with perf.step(f"llm:{name}"):
                # ⬇️ ZIP 처리도 LLM은 워커 스레드로
                summary = await anyio.to_thread.run_sync(summarize_and_categorize, text)
            result = {
                "filename": name,
                "pages": pages,
                "summary": summary
            }
            zout.writestr(f"{name}.json", json.dumps(result, ensure_ascii=False, indent=2))
    telemetry.merge(perf.to_telemetry())
    memzip.seek(0)
    headers = {"X-Telemetry": json.dumps(telemetry.data)}
    return StreamingResponse(memzip, media_type="application/zip", headers=headers)

# === 청크 업로드 세션 ===
@app.post("/api/v1/upload/session")
def create_session():
    sid = str(uuid.uuid4())
    os.makedirs(f"{SESS_ROOT}", exist_ok=True)
    open(f"{SESS_ROOT}/{sid}.part", "wb").close()
    return {"session_id": sid}

@app.patch("/api/v1/upload/session/{sid}")
async def append_chunk(sid: str, chunk: UploadFile = File(...)):
    path = f"{SESS_ROOT}/{sid}.part"
    if not os.path.exists(path):
        return JSONResponse(status_code=404, content={"error": "session not found"})
    data = await chunk.read()
    with open(path, "ab") as f:
        f.write(data)
    return {"ok": True, "bytes": len(data)}

@app.post("/api/v1/upload/session/{sid}/finalize")
async def finalize_session(sid: str, is_zip: bool = Form(True)):
    path = f"{SESS_ROOT}/{sid}.part"
    if not os.path.exists(path):
        return JSONResponse(status_code=404, content={"error": "session not found"})
    with open(path, "rb") as f:
        blob = bytes(f.read())
    os.remove(path)
    if is_zip:
        memzip = io.BytesIO()
        with zipfile.ZipFile(memzip, 'w', zipfile.ZIP_DEFLATED) as zout:
            for name, text, pages in batch_ocr_zip(blob):
                # ⬇️ ZIP finalize에서도 LLM은 워커 스레드로
                summary = await anyio.to_thread.run_sync(summarize_and_categorize, text)
                result = {"filename": name, "pages": pages, "summary": summary}
                zout.writestr(f"{name}.json", json.dumps(result, ensure_ascii=False, indent=2))
        memzip.seek(0)
        return StreamingResponse(memzip, media_type="application/zip")
    else:
        # ⬇️ OCR (동기) + 요약(워커 스레드)
        text, pages, meta, per_page_texts = ocr_funnel_extract(blob, filename="upload.bin", mode="quality")
        summary = await anyio.to_thread.run_sync(summarize_and_categorize, text)

        doc_id = str(uuid.uuid4())
        _store_doc(doc_id, {
            "doc_id": doc_id,
            "filename": "upload.bin",
            "pages": pages,
            "full_text": text,
            "per_page": per_page_texts,
            "meta": meta,
            "summary": summary,
            "ts": int(time.time()),
        })
        return {"doc_id": doc_id, "pages": pages, "summary": summary}
    
@app.post("/api/v1/logout")
def logout_alias(token_data: dict = Depends(decode_access_token)):
    return {"success": True}    
    

from services.capcha import router as captcha_router   
from services.signup import router as signup_router
from services.login import router as login_router
from routers.admin_router import router as admin_router
from routers.user_check_router import router as user_check_router
from routers.email_verify_router import router as email_verify_router
from routers.mypage_router import router as mypage_router
from routers import comments
from routers import oauth_kakao

app.include_router(captcha_router)
app.include_router(signup_router)
app.include_router(login_router)
app.include_router(admin_router)
app.include_router(user_check_router)
app.include_router(email_verify_router)
app.include_router(mypage_router)
app.include_router(comments.router)
app.include_router(oauth_kakao.router)