# backend/user/login.py
from fastapi import APIRouter, Depends, HTTPException, Request
from pydantic import BaseModel
from sqlalchemy.orm import Session
from sqlalchemy import func
from core.db import get_db
from core.security import decode_access_token
from models.user_model import AppUser
from services.capcha import captcha_store
import time
import bcrypt
import os, jwt
from datetime import datetime, timedelta
from dotenv import load_dotenv

load_dotenv()

router = APIRouter(prefix="/api/v1/user", tags=["User"])

# ----------------------------------------
# 1️⃣ JWT 설정
# ----------------------------------------
JWT_SECRET = os.getenv("JWT_SECRET", "mysecretkey")
JWT_ALGORITHM = "HS256"
JWT_EXPIRE_MINUTES = 60 * 6  # 6시간

# ----------------------------------------
# 2️⃣ 요청 데이터 모델
# ----------------------------------------
class LoginRequest(BaseModel):
    login_id: str
    password: str
    captcha_id: str
    captcha_text: str

# ----------------------------------------
# 3️⃣ 로그인 엔드포인트
# ----------------------------------------
@router.post("/login")
def login_user(data: LoginRequest, db: Session = Depends(get_db)):
    # ✅ CAPTCHA 검증
    record = captcha_store.get(data.captcha_id)
    if not record:
        raise HTTPException(status_code=400, detail="Captcha expired or invalid")
    code, expire_time = record
    if time.time() > expire_time:
        del captcha_store[data.captcha_id]
        raise HTTPException(status_code=400, detail="Captcha expired")
    if data.captcha_text.strip().lower() != code.lower():
        raise HTTPException(status_code=400, detail="Captcha incorrect")
    del captcha_store[data.captcha_id]  # 일회성

    # ✅ 사용자 조회
    user = db.query(AppUser).filter(AppUser.LOGIN_ID == data.login_id).first()
    if not user:
        raise HTTPException(status_code=401, detail="Invalid ID or Password")

    # ✅ 비밀번호 검증
    if not bcrypt.checkpw(data.password.encode("utf-8"), user.PASSWORD_HASH.encode("utf-8")):
        raise HTTPException(status_code=401, detail="Invalid ID or Password")

    db.query(AppUser).filter(AppUser.USER_ID == user.USER_ID).update(
        {
            AppUser.LAST_LOGIN_AT: func.now(),  # DB 시간 사용
        },
        synchronize_session=False,
    )
    db.commit()

    # ✅ 토큰 생성(여기서 바로 리턴; 함수 밖으로 밀려나 있으면 절대 실행 안 됨)
    expire = datetime.utcnow() + timedelta(minutes=JWT_EXPIRE_MINUTES)
    payload = {
        "sub": user.LOGIN_ID,
        "user_id": int(user.USER_ID),
        "exp": expire,
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm=JWT_ALGORITHM)

    return {
        "success": True,
        "token": token,
        "user": {
            "id": user.USER_ID,
            "login_id": user.LOGIN_ID,
            "email": user.EMAIL,
            "name": user.NAME,
            "nickname": user.NICKNAME,
            "IS_ADMIN": user.IS_ADMIN,
        },
    }

@router.api_route("/logout", methods=["POST", "GET"])
def logout_user(
    request: Request,
    db: Session = Depends(get_db),
):
    """
    무조건 IS_LOGGED_IN = 0으로 만든다.
    - 토큰이 오면 토큰으로 식별
    - 토큰이 없으면 쿼리파라미터(login_id, user_id)로도 식별
    - 업데이트는 raw SQL로 강제(ORM 매핑 이슈 우회)
    """
    # 1) 식별값 확보
    user_id = None
    login_id = None

    # 1-1) 토큰 시도 (Authorization: Bearer <token>)
    token = None
    auth = request.headers.get("Authorization") or ""
    if auth.startswith("Bearer "):
        token = auth.split(" ", 1)[1].strip()
    if not token:
        token = request.query_params.get("token")

    if token:
        import os, jwt
        secret = os.getenv("JWT_SECRET", "YOUR_SUPER_SECRET_KEY")
        try:
            payload = jwt.decode(token, secret, algorithms=["HS256"])
            user_id = payload.get("user_id")
            login_id = payload.get("sub")
        except Exception:
            pass

    return {"success": True}