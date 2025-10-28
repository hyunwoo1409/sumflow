import random
import string
from datetime import datetime, timedelta
from sqlalchemy.orm import Session
from fastapi import HTTPException

from app.models.email_verification_model import EmailVerification
from app.models.user_model import AppUser

# 이메일 인증 발송
import smtplib
from email.mime.text import MIMEText
import os


# 실제 메일 발송 서비스
# 일단 개발 단계에서는 그냥 print로 떼우고 나중에 SMTP 붙이면 됨
def send_email(to: str, subject: str, body: str):

    smtp_host = os.getenv("SMTP_HOST", "smtp.gmail.com")
    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USER")  # 보내는 계정
    smtp_pass = os.getenv("SMTP_PASS")  # 앱 비밀번호
    from_addr = os.getenv("SMTP_FROM", smtp_user)

    if not smtp_user or not smtp_pass:
        print("=== SEND EMAIL (FAKE MODE) ===")
        print("TO:", to)
        print("SUBJECT:", subject)
        print("BODY:", body)
        print("==============================")
        return

    # 메일 내용 만들기
    msg = MIMEText(body, _charset="utf-8")
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to

    # SMTP 서버 접속해서 전송
    with smtplib.SMTP(smtp_host, smtp_port) as server:
        server.starttls()  # TLS 보안 연결
        server.login(smtp_user, smtp_pass)
        server.sendmail(from_addr, [to], msg.as_string())

    print(f"[메일 전송 완료] -> {to}")

def _gen_code(length=6):
    return ''.join(random.choices(string.digits, k=length))

def create_and_send_code(db: Session, email: str, purpose: str = "REGISTER"):
    exists = db.query(AppUser).filter(AppUser.EMAIL == email).first()
    if exists:
        raise HTTPException(status_code=400, detail="이미 등록된 이메일입니다.")

    code = _gen_code(6)
    now = datetime.utcnow()
    expires_at = now + timedelta(minutes=10)

    row = EmailVerification(
        EMAIL=email,
        CODE=code,
        PURPOSE=purpose,
        IS_USED=False,
        EXPIRES_AT=expires_at,
        CREATED_AT=now,
    )

    db.add(row)
    db.commit()
    db.refresh(row)

    # 메일 보내기
    send_email(
        to=email,
        subject="[SumFlow] 이메일 인증번호",
        body=f"인증번호: {code}\n10분 안에 입력해주세요.",
    )

    return {"success": True}


def verify_code(db: Session, email: str, code: str, purpose: str = "REGISTER"):
    # 가장 최근 기록 하나 가져와서 검증
    row = (
        db.query(EmailVerification)
        .filter(
            EmailVerification.EMAIL == email,
            EmailVerification.PURPOSE == purpose,
        )
        .order_by(EmailVerification.VERIF_ID.desc())
        .first()
    )

    if not row:
        raise HTTPException(status_code=400, detail="인증 기록이 없습니다.")

    # 만료 체크
    now = datetime.utcnow()
    if now > row.EXPIRES_AT:
        raise HTTPException(status_code=400, detail="인증번호가 만료되었습니다.")

    # 코드 체크
    if row.CODE != code:
        raise HTTPException(status_code=400, detail="인증번호가 올바르지 않습니다.")

    # 재사용 방지
    if row.IS_USED:
        raise HTTPException(status_code=400, detail="이미 사용된 인증번호입니다.")

    # 여기서 사용 처리
    row.IS_USED = True
    db.commit()

    return {"success": True}


def assert_email_verified(db: Session, email: str, purpose: str = "REGISTER"):
    """
    회원가입 직전에 호출해서
    '이 이메일은 실제로(방금) 인증된 상태냐' 를 체크.
    """
    row = (
        db.query(EmailVerification)
        .filter(
            EmailVerification.EMAIL == email,
            EmailVerification.PURPOSE == purpose,
            EmailVerification.IS_USED == True,
        )
        .order_by(EmailVerification.VERIF_ID.desc())
        .first()
    )

    if not row:
        raise HTTPException(status_code=400, detail="이메일 인증이 완료되지 않았습니다.")