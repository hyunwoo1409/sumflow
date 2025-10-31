from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import RedirectResponse
import os, requests, jwt, datetime

router = APIRouter(prefix="/oauth/kakao", tags=["OAuth"])

KAKAO_CLIENT_ID = os.getenv("KAKAO_CLIENT_ID")
KAKAO_CLIENT_SECRET = os.getenv("KAKAO_CLIENT_SECRET")
KAKAO_REDIRECT = os.getenv("KAKAO_REDIRECT")  # http://127.0.0.1:4000/api/v1/oauth/kakao/callback
FRONT_AFTER_LOGIN = os.getenv("FRONT_AFTER_LOGIN", "http://localhost:5173/")
JWT_SECRET = os.getenv("JWT_SECRET", "dev")

@router.get("/callback")
def kakao_callback(code: str, state: str | None = None, request: Request = None):
    # 0) state 검증 (프론트에서 sessionStorage에 넣은 값과 비교)
    #    - 브라우저 세션에 있는 값을 서버가 직접 볼 수는 없으니
    #      실제 서비스에서는 서버 세션/DB/REDIS 등에 state를 저장해두고 비교 권장
    #    - 개발 편의상: 최소한 state 존재/형식 확인 정도라도 하자
    if not state or len(state) < 2:
        raise HTTPException(status_code=400, detail="Invalid state")

    # 1) 토큰 교환
    token_url = "https://kauth.kakao.com/oauth/token"
    data = {
        "grant_type": "authorization_code",
        "client_id": KAKAO_CLIENT_ID,
        "client_secret": KAKAO_CLIENT_SECRET,
        "redirect_uri": KAKAO_REDIRECT,
        "code": code,
    }
    res = requests.post(token_url, data=data, timeout=10)
    if res.status_code != 200:
        raise HTTPException(status_code=400, detail=f"토큰 발급 실패: {res.text}")
    token_json = res.json()
    access_token = token_json.get("access_token")
    if not access_token:
        raise HTTPException(status_code=400, detail=f"토큰 없음: {token_json}")

    # 2) 사용자 정보
    me_res = requests.get(
        "https://kapi.kakao.com/v2/user/me",
        headers={"Authorization": f"Bearer {access_token}"},
        timeout=10,
    )
    if me_res.status_code != 200:
        raise HTTPException(status_code=400, detail=f"사용자 조회 실패: {me_res.text}")
    me = me_res.json()

    kakao_id = me.get("id")
    kakao_account = me.get("kakao_account", {}) or {}
    kakao_email = kakao_account.get("email")  # 동의 안 하면 None
    kakao_nickname = (kakao_account.get("profile") or {}).get("nickname")

    if not kakao_id:
        raise HTTPException(status_code=400, detail="카카오 ID 누락")

    # 이메일이 없을 때의 대책 (임시/대체 이메일 부여 or 이메일 없이 가입)
    if not kakao_email:
        kakao_email = f"kakao_{kakao_id}@example.invalid"

    # 3) DB 가입/로그인 처리 (예시)
    user = {"id": kakao_id, "email": kakao_email, "nickname": kakao_nickname}

    # 4) JWT 발급
    payload = {
        "sub": str(user["id"]),
        "email": user["email"],
        "exp": datetime.datetime.utcnow() + datetime.timedelta(hours=6),
    }
    token = jwt.encode(payload, JWT_SECRET, algorithm="HS256")

    redirect_url = f"{FRONT_AFTER_LOGIN}login?token={token}"
    return RedirectResponse(redirect_url, status_code=302)