from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from core.db import get_db
from models.user_model import AppUser

router = APIRouter(
    prefix="/api/v1/user",
    tags=["User"],
)

@router.get("/check-id")
def check_id(login_id: str, db: Session = Depends(get_db)):
    """
    아이디(login_id) 중복 여부 확인
    return:
      "1" -> 이미 사용 중
      "0" -> 사용 가능
    """

    exists = (
        db.query(AppUser)
        .filter(AppUser.LOGIN_ID == login_id)
        .first()
    )

    return "1" if exists else "0"


@router.get("/check-email")
def check_email(email: str, db: Session = Depends(get_db)):
    """
    이메일(email) 중복 여부 확인
    return:
      "1" -> 이미 사용 중
      "0" -> 사용 가능
    """

    exists = (
        db.query(AppUser)
        .filter(AppUser.EMAIL == email)
        .first()
    )

    return "1" if exists else "0"