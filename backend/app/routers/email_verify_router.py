from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, EmailStr
from sqlalchemy.orm import Session

from core.db import get_db
from services.email_verify import create_and_send_code, verify_code

router = APIRouter(
    prefix="/api/v1/user",
    tags=["User"],
)

class SendCodeRequest(BaseModel):
    email: EmailStr
    purpose: str = "REGISTER"

class VerifyCodeRequest(BaseModel):
    email: EmailStr
    code: str
    purpose: str = "REGISTER"


@router.post("/email/send-code")
def send_code(data: SendCodeRequest, db: Session = Depends(get_db)):
    return create_and_send_code(db, data.email, data.purpose)


@router.post("/email/verify-code")
def check_code(data: VerifyCodeRequest, db: Session = Depends(get_db)):
    return verify_code(db, data.email, data.code, data.purpose)