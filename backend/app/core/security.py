import os
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

"""
이 모듈은
- Authorization: Bearer <JWT> 헤더에서 토큰을 꺼낸다
- 토큰을 디코드해서 payload(dict)를 돌려준다
"""

# FastAPI에서 Bearer 토큰 읽을 때 쓰는 의존성
bearer_scheme = HTTPBearer(auto_error=True)

# 시크릿키 / 알고리즘 (환경변수에서 불러오고, 없으면 기본값)
JWT_SECRET = os.getenv("JWT_SECRET", "CHANGE_ME_SECRET")
JWT_ALGO = os.getenv("JWT_ALGO", "HS256")

def decode_access_token(
    cred: HTTPAuthorizationCredentials = Depends(bearer_scheme),
):
    """
    HTTP Authorization 헤더에서 Bearer 토큰을 읽고
    디코드한 payload(dict)를 리턴한다.
    """
    token = cred.credentials
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="토큰이 없습니다.",
        )

    try:
        payload = jwt.decode(token, JWT_SECRET, algorithms=[JWT_ALGO])
        # payload 예: {"user_id": 123, "is_admin": True, "exp": ...}
        return payload
    except jwt.ExpiredSignatureError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="토큰이 만료되었습니다.",
        )
    except jwt.InvalidTokenError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="유효하지 않은 토큰입니다.",
        )
    
def get_current_user(payload: dict = Depends(decode_access_token)):
    """
    decode_access_token() 결과(payload)에서 user_id를 꺼내
    API 내부에서 통일된 형태로 반환한다.
    """
    user_id = payload.get("user_id")
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="user_id가 토큰에 없습니다.",
        )

    # 필요한 최소 정보만 반환 (dict로)
    return {
        "USER_ID": user_id,
        "IS_ADMIN": payload.get("is_admin", False),
        "EMAIL": payload.get("email"),
    }    