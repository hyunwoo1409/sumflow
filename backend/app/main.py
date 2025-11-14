import os, jwt
from fastapi import FastAPI, Request, Depends
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text
from dotenv import load_dotenv
load_dotenv()

# --- 내부 서비스/유틸 ---
from core.db import SessionLocal
from core.security import decode_access_token
from models.visitlog_model import VisitLog
from models.user_model import AppUser

# =========================
# 기본 설정/로그
# =========================
APP_NAME = "ocr-llm-suite"

app = FastAPI(title=APP_NAME)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"], allow_credentials=True,
    allow_methods=["*"], allow_headers=["*"],
)

# =========================
# 방문 로그 미들웨어 (하루 1회/유저)
# =========================
@app.middleware("http")
async def _visit_logger(request: Request, call_next):
    path = request.url.path
    if path.startswith(("/docs", "/redoc", "/openapi")):
        return await call_next(request)

    if request.method in ("GET", "HEAD"):
        db = SessionLocal()
        try:
            user_id = None
            auth = request.headers.get("Authorization", "")
            if auth.startswith("Bearer "):
                token = auth.split(" ", 1)[1]
                secret = os.getenv("JWT_SECRET", "mysecretkey")
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
                            SELECT 1 FROM VISIT_LOG
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

# =========================
# 인증 보조
# =========================
@app.post("/api/v1/logout")
def logout_alias(token_data: dict = Depends(decode_access_token)):
    return {"success": True}

# =========================
# 기존 라우터들
# =========================
from services.captcha import router as captcha_router
from services.signup import router as signup_router
from services.login import router as login_router
from routers.admin_router import router as admin_router
from routers.user_check_router import router as user_check_router
from routers.email_verify_router import router as email_verify_router
from routers.mypage_router import router as mypage_router
from routers import comments
from routers.account_recovery_router import router as account_recovery_router
from routers.documents import router as documents_router
from routers.download import router as download_router
from api.v1.ocr_router import router as ocr_router
from api.v1.ocr_raw_router import router as ocr_raw_router
from api.v1.task_router import router as task_router
from api.v1.batch_router import router as batch_router
from routers.ocr_commit_router import router as ocr_commit_router


app.include_router(captcha_router)
app.include_router(signup_router)
app.include_router(login_router)
app.include_router(admin_router)
app.include_router(user_check_router)
app.include_router(email_verify_router)
app.include_router(mypage_router)
app.include_router(comments.router)
app.include_router(account_recovery_router)
app.include_router(documents_router)
app.include_router(download_router)
app.include_router(ocr_router)
app.include_router(ocr_raw_router)
app.include_router(task_router)
app.include_router(batch_router)
app.include_router(ocr_commit_router)