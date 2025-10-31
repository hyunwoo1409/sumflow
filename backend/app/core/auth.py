from fastapi import Header, HTTPException
import jwt
import os
from dotenv import load_dotenv

# .env 파일 로드
load_dotenv()

# 환경변수에서 JWT 설정 읽기
JWT_SECRET = os.getenv("JWT_SECRET", "mysecretkey")
JWT_ALGORITHM = os.getenv("JWT_ALGORITHM", "HS256")

def decode_access_token(authorization: str = Header(None)):
    """
    Authorization 헤더의 JWT 토큰을 검증하고 payload(dict)를 반환한다.
    예:
        Authorization: Bearer <token>
    """
    if not authorization:
        raise HTTPException(status_code=401, detail="Authorization 헤더가 없습니다.")
    if not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Bearer 토큰 형식이 아닙니다.")

    token = authorization.split(" ", 1)[1].strip()
    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGORITHM])
        # payload 예시: {"user_id": 1, "nickname": "현우", "exp": 1730311200}
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="토큰이 만료되었습니다.")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="유효하지 않은 토큰입니다.")